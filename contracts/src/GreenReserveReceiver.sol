pragma solidity ^0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

import {CCIPReceiver} from "@ccip/ccip/applications/CCIPReceiver.sol";
import {Client} from "@ccip/ccip/libraries/Client.sol";

import {GreenReserveTokenB} from "./GreenReserveTokenB.sol";

contract GreenReserveReceiver is CCIPReceiver, Ownable {
  GreenReserveTokenB public immutable token;

  mapping(uint64 chainSelector => bool allowed) public allowlistedSourceChains;
  mapping(address sender => bool allowed) public allowlistedSenders;
  mapping(bytes32 depositId => bool processed) public processedDepositId;

  error SourceChainNotAllowed(uint64 selector);
  error SenderNotAllowed(address sender);
  error DepositIdAlreadyProcessed(bytes32 depositId);

  event MessageReceived(bytes32 indexed messageId, bytes32 indexed depositId, address indexed to, uint256 amount);

  constructor(address routerAddress, address tokenAddress, address initialOwner) CCIPReceiver(routerAddress) Ownable(initialOwner) {
    token = GreenReserveTokenB(tokenAddress);
  }

  function setAllowlistedSourceChain(uint64 chainSelector, bool allowed) external onlyOwner {
    allowlistedSourceChains[chainSelector] = allowed;
  }

  function setAllowlistedSender(address sender, bool allowed) external onlyOwner {
    allowlistedSenders[sender] = allowed;
  }

  function _ccipReceive(Client.Any2EVMMessage memory message) internal override {
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
}
