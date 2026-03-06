pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {Client} from "@ccip/ccip/libraries/Client.sol";

import {GreenReserveReceiver} from "../src/GreenReserveReceiver.sol";
import {GreenReserveTokenB} from "../src/GreenReserveTokenB.sol";

contract GreenReserveReceiverTest is Test {
  uint64 internal constant SOURCE_CHAIN_SELECTOR = 16015286601757825753;

  GreenReserveTokenB internal token;
  GreenReserveReceiver internal receiver;

  address internal owner = address(this);
  address internal sourceSender = address(0xA11CE);
  address internal user = address(0xB0B);

  function setUp() external {
    token = new GreenReserveTokenB("GreenReserve TokenB", "GRB", owner);
    receiver = new GreenReserveReceiver(address(this), address(token), owner);
    token.setMinter(address(receiver));
    receiver.setAllowlistedSourceChain(SOURCE_CHAIN_SELECTOR, true);
  }

  function testCcipReceiveSuccessMintsAndMarksProcessed() external {
    receiver.setAllowlistedSender(sourceSender, true);

    bytes32 depositId = keccak256("deposit-success");
    bytes32 messageId = keccak256("message-success");
    Client.Any2EVMMessage memory message = _message(messageId, depositId, user, 123 ether, sourceSender);

    receiver.ccipReceive(message);

    assertTrue(receiver.processedDepositId(depositId));
    assertEq(token.balanceOf(user), 123 ether);
    assertEq(uint256(receiver.failedMessageState(messageId)), uint256(GreenReserveReceiver.FailedMessageState.NONE));
  }

  function testCcipReceiveFailureStoresMessageWithoutReverting() external {
    bytes32 depositId = keccak256("deposit-failed");
    bytes32 messageId = keccak256("message-failed");
    Client.Any2EVMMessage memory message = _message(messageId, depositId, user, 50 ether, sourceSender);

    receiver.ccipReceive(message);

    (GreenReserveReceiver.FailedMessageState state, bytes memory reason, uint64 sourceChainSelector, bytes memory sender, bytes memory data) = receiver
      .getFailedMessage(messageId);

    assertEq(uint256(state), uint256(GreenReserveReceiver.FailedMessageState.FAILED));
    assertGt(reason.length, 0);
    assertEq(sourceChainSelector, SOURCE_CHAIN_SELECTOR);
    assertEq(keccak256(sender), keccak256(abi.encode(sourceSender)));
    assertEq(keccak256(data), keccak256(abi.encode(user, 50 ether, depositId)));
    assertFalse(receiver.processedDepositId(depositId));
    assertEq(token.balanceOf(user), 0);
  }

  function testRetryFailedMessageProcessesStoredMessageAfterFix() external {
    bytes32 depositId = keccak256("deposit-retry");
    bytes32 messageId = keccak256("message-retry");
    Client.Any2EVMMessage memory message = _message(messageId, depositId, user, 75 ether, sourceSender);

    receiver.ccipReceive(message);
    assertEq(uint256(receiver.failedMessageState(messageId)), uint256(GreenReserveReceiver.FailedMessageState.FAILED));

    receiver.setAllowlistedSender(sourceSender, true);
    receiver.retryFailedMessage(messageId);

    assertEq(uint256(receiver.failedMessageState(messageId)), uint256(GreenReserveReceiver.FailedMessageState.RESOLVED));
    assertTrue(receiver.processedDepositId(depositId));
    assertEq(token.balanceOf(user), 75 ether);
  }

  function testResolveFailedMessageMarksResolvedWithoutMint() external {
    bytes32 depositId = keccak256("deposit-resolve");
    bytes32 messageId = keccak256("message-resolve");
    Client.Any2EVMMessage memory message = _message(messageId, depositId, user, 25 ether, sourceSender);

    receiver.ccipReceive(message);
    receiver.resolveFailedMessage(messageId);

    assertEq(uint256(receiver.failedMessageState(messageId)), uint256(GreenReserveReceiver.FailedMessageState.RESOLVED));
    assertFalse(receiver.processedDepositId(depositId));
    assertEq(token.balanceOf(user), 0);

    vm.expectRevert(abi.encodeWithSelector(GreenReserveReceiver.MessageNotFailed.selector, messageId));
    receiver.retryFailedMessage(messageId);
  }

  function _message(
    bytes32 messageId,
    bytes32 depositId,
    address to,
    uint256 amount,
    address sender
  ) internal pure returns (Client.Any2EVMMessage memory message) {
    message.messageId = messageId;
    message.sourceChainSelector = SOURCE_CHAIN_SELECTOR;
    message.sender = abi.encode(sender);
    message.data = abi.encode(to, amount, depositId);
    message.destTokenAmounts = new Client.EVMTokenAmount[](0);
  }
}
