pragma solidity ^0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

import {CCIPReceiver} from "@ccip/ccip/applications/CCIPReceiver.sol";
import {Client} from "@ccip/ccip/libraries/Client.sol";

import {GreenReserveTokenB} from "./GreenReserveTokenB.sol";

contract GreenReserveReceiver is CCIPReceiver, Ownable {
  enum FailedMessageState {
    NONE,
    FAILED,
    RESOLVED
  }

  GreenReserveTokenB public immutable token;

  mapping(uint64 chainSelector => bool allowed) public allowlistedSourceChains;
  mapping(address sender => bool allowed) public allowlistedSenders;
  mapping(bytes32 depositId => bool processed) public processedDepositId;
  mapping(bytes32 messageId => Client.Any2EVMMessage message) internal failedMessageContents;
  mapping(bytes32 messageId => bytes reason) internal failedMessageReasons;
  mapping(bytes32 messageId => FailedMessageState state) public failedMessageState;

  error SourceChainNotAllowed(uint64 selector);
  error SenderNotAllowed(address sender);
  error DepositIdAlreadyProcessed(bytes32 depositId);
  error MessageNotFailed(bytes32 messageId);
  error OnlySelf();

  event MessageReceived(bytes32 indexed messageId, bytes32 indexed depositId, address indexed to, uint256 amount);
  event MessageFailed(bytes32 indexed messageId, bytes reason);
  event MessageRetried(bytes32 indexed messageId);
  event MessageResolved(bytes32 indexed messageId);

  constructor(address routerAddress, address tokenAddress, address initialOwner) CCIPReceiver(routerAddress) Ownable(initialOwner) {
    token = GreenReserveTokenB(tokenAddress);
  }

  function setAllowlistedSourceChain(uint64 chainSelector, bool allowed) external onlyOwner {
    allowlistedSourceChains[chainSelector] = allowed;
  }

  function setAllowlistedSender(address sender, bool allowed) external onlyOwner {
    allowlistedSenders[sender] = allowed;
  }

  function ccipReceive(Client.Any2EVMMessage calldata message) external override onlyRouter {
    try this.processMessage(message) {
      return;
    } catch (bytes memory err) {
      failedMessageContents[message.messageId] = message;
      failedMessageReasons[message.messageId] = err;
      failedMessageState[message.messageId] = FailedMessageState.FAILED;
      emit MessageFailed(message.messageId, err);
    }
  }

  function processMessage(Client.Any2EVMMessage calldata message) external onlySelf {
    _processMessage(message);
  }

  function retryFailedMessage(bytes32 messageId) external onlyOwner {
    if (failedMessageState[messageId] != FailedMessageState.FAILED) revert MessageNotFailed(messageId);

    failedMessageState[messageId] = FailedMessageState.RESOLVED;
    Client.Any2EVMMessage memory message = failedMessageContents[messageId];
    _processMessage(message);

    emit MessageRetried(messageId);
  }

  function resolveFailedMessage(bytes32 messageId) external onlyOwner {
    if (failedMessageState[messageId] != FailedMessageState.FAILED) revert MessageNotFailed(messageId);

    failedMessageState[messageId] = FailedMessageState.RESOLVED;
    emit MessageResolved(messageId);
  }

  function getFailedMessage(
    bytes32 messageId
  ) external view returns (FailedMessageState state, bytes memory reason, uint64 sourceChainSelector, bytes memory sender, bytes memory data) {
    Client.Any2EVMMessage storage message = failedMessageContents[messageId];
    return (
      failedMessageState[messageId],
      failedMessageReasons[messageId],
      message.sourceChainSelector,
      message.sender,
      message.data
    );
  }

  function _ccipReceive(Client.Any2EVMMessage memory message) internal override {
    _processMessage(message);
  }

  function _processMessage(Client.Any2EVMMessage memory message) internal {
    if (!allowlistedSourceChains[message.sourceChainSelector]) {
      revert SourceChainNotAllowed(message.sourceChainSelector);
    }

    address sender = abi.decode(message.sender, (address));
    if (!allowlistedSenders[sender]) revert SenderNotAllowed(sender);

    (address to, uint256 amount, bytes32 depositId) = abi.decode(message.data, (address, uint256, bytes32));

    if (processedDepositId[depositId]) revert DepositIdAlreadyProcessed(depositId);
    processedDepositId[depositId] = true;

    token.mint(to, amount);

    emit MessageReceived(message.messageId, depositId, to, amount);
  }

  modifier onlySelf() {
    if (msg.sender != address(this)) revert OnlySelf();
    _;
  }
}
