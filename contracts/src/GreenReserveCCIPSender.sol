pragma solidity ^0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

import {Client} from "@ccip/ccip/libraries/Client.sol";
import {IRouterClient} from "@ccip/ccip/interfaces/IRouterClient.sol";

contract GreenReserveCCIPSender is Ownable {
  IRouterClient public immutable router;

  uint64 public destinationChainSelector;
  address public destinationReceiver;
  address public operator;
  uint256 public gasLimit;

  error NotOperator(address caller);
  error InsufficientFee(uint256 provided, uint256 required);

  event MessageSent(bytes32 indexed messageId, bytes32 indexed depositId, address indexed to, uint256 amount);

  constructor(
    address routerAddress,
    uint64 destChainSelector,
    address destReceiver,
    address initialOwner,
    address initialOperator,
    uint256 initialGasLimit
  ) Ownable(initialOwner) {
    router = IRouterClient(routerAddress);
    destinationChainSelector = destChainSelector;
    destinationReceiver = destReceiver;
    operator = initialOperator;
    gasLimit = initialGasLimit;
  }

  function setOperator(address newOperator) external onlyOwner {
    operator = newOperator;
  }

  function setDestination(uint64 destChainSelector, address destReceiver) external onlyOwner {
    destinationChainSelector = destChainSelector;
    destinationReceiver = destReceiver;
  }

  function setGasLimit(uint256 newGasLimit) external onlyOwner {
    gasLimit = newGasLimit;
  }

  function _buildMessage(address to, uint256 amount, bytes32 depositId) internal view returns (Client.EVM2AnyMessage memory) {
    Client.EVM2AnyMessage memory message;
    message.receiver = abi.encode(destinationReceiver);
    message.data = abi.encode(to, amount, depositId);
    message.tokenAmounts = new Client.EVMTokenAmount[](0);
    message.feeToken = address(0);
    message.extraArgs = Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: gasLimit}));
    return message;
  }

  function estimateFee(address to, uint256 amount, bytes32 depositId) external view returns (uint256) {
    Client.EVM2AnyMessage memory message = _buildMessage(to, amount, depositId);
    return router.getFee(destinationChainSelector, message);
  }

  function send(address to, uint256 amount, bytes32 depositId) external payable returns (bytes32 messageId) {
    if (msg.sender != operator) revert NotOperator(msg.sender);
    if (!router.isChainSupported(destinationChainSelector)) {
      revert IRouterClient.UnsupportedDestinationChain(destinationChainSelector);
    }

    Client.EVM2AnyMessage memory message = _buildMessage(to, amount, depositId);
    uint256 fee = router.getFee(destinationChainSelector, message);
    if (msg.value < fee) revert InsufficientFee(msg.value, fee);

    messageId = router.ccipSend{value: fee}(destinationChainSelector, message);
    emit MessageSent(messageId, depositId, to, amount);
  }
}
