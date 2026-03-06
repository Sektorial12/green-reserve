pragma solidity ^0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {Pausable} from "openzeppelin-contracts/contracts/utils/Pausable.sol";

import {GreenReserveTokenA} from "./GreenReserveTokenA.sol";

interface IGreenReserveAuditRegistry {
  function auditByDepositId(bytes32 depositId)
    external
    view
    returns (
      bytes32 depositNoticeHash,
      bytes32 reserveAttestationHash,
      bytes32 complianceDecisionHash,
      bytes32 aiOutputHash,
      uint64 updatedAt,
      address updater
    );
}

contract GreenReserveIssuer is Ownable, Pausable {
  GreenReserveTokenA public immutable token;
  address public operator;
  address public auditRegistry;

  mapping(bytes32 depositId => bool used) public usedDepositId;

  error NotOperator(address caller);
  error DepositIdUsed(bytes32 depositId);
  error AuditNotRecorded(bytes32 depositId);
  error AuditRegistryCallFailed(address auditRegistry);

  event AuditRegistrySet(address indexed auditRegistry);
  event AuditRegistryValidated(bytes32 indexed depositId, address indexed auditRegistry, uint64 updatedAt, address updater);
  event MintApproved(bytes32 indexed depositId, address indexed to, uint256 amount);

  constructor(address tokenAddress, address initialOwner, address initialOperator) Ownable(initialOwner) {
    token = GreenReserveTokenA(tokenAddress);
    operator = initialOperator;
  }

  function setOperator(address newOperator) external onlyOwner {
    operator = newOperator;
  }

  function setAuditRegistry(address newAuditRegistry) external onlyOwner {
    auditRegistry = newAuditRegistry;
    emit AuditRegistrySet(newAuditRegistry);
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

    if (auditRegistry != address(0)) {
      try IGreenReserveAuditRegistry(auditRegistry).auditByDepositId(depositId) returns (
        bytes32,
        bytes32,
        bytes32,
        bytes32,
        uint64 updatedAt,
        address updater
      ) {
        if (updatedAt == 0) revert AuditNotRecorded(depositId);
        emit AuditRegistryValidated(depositId, auditRegistry, updatedAt, updater);
      } catch {
        revert AuditRegistryCallFailed(auditRegistry);
      }
    }

    usedDepositId[depositId] = true;
    token.mint(to, amount);

    emit MintApproved(depositId, to, amount);
  }
}
