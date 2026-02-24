pragma solidity ^0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {Pausable} from "openzeppelin-contracts/contracts/utils/Pausable.sol";

import {GreenReserveTokenA} from "./GreenReserveTokenA.sol";

contract GreenReserveIssuer is Ownable, Pausable {
  GreenReserveTokenA public immutable token;
  address public operator;

  mapping(bytes32 depositId => bool used) public usedDepositId;

  error NotOperator(address caller);
  error DepositIdUsed(bytes32 depositId);

  event MintApproved(bytes32 indexed depositId, address indexed to, uint256 amount);

  constructor(address tokenAddress, address initialOwner, address initialOperator) Ownable(initialOwner) {
    token = GreenReserveTokenA(tokenAddress);
    operator = initialOperator;
  }

  function setOperator(address newOperator) external onlyOwner {
    operator = newOperator;
  }

  function pause() external onlyOwner {
    _pause();
  }

  function unpause() external onlyOwner {
    _unpause();
  }

  function mint(address to, uint256 amount, bytes32 depositId) external whenNotPaused {
    if (msg.sender != operator) revert NotOperator(msg.sender);
    if (usedDepositId[depositId]) revert DepositIdUsed(depositId);

    usedDepositId[depositId] = true;
    token.mint(to, amount);

    emit MintApproved(depositId, to, amount);
  }
}
