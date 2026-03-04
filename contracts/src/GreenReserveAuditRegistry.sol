pragma solidity ^0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

contract GreenReserveAuditRegistry is Ownable {
  address public operator;

  struct AuditEntry {
    bytes32 depositNoticeHash;
    bytes32 reserveAttestationHash;
    bytes32 complianceDecisionHash;
    bytes32 aiOutputHash;
    uint64 updatedAt;
    address updater;
  }

  mapping(bytes32 depositId => AuditEntry entry) public auditByDepositId;

  error NotOperator(address caller);

  event AuditRecorded(
    bytes32 indexed depositId,
    bytes32 depositNoticeHash,
    bytes32 reserveAttestationHash,
    bytes32 complianceDecisionHash,
    bytes32 aiOutputHash,
    address indexed updater
  );

  constructor(address initialOwner, address initialOperator) Ownable(initialOwner) {
    operator = initialOperator;
  }

  function setOperator(address newOperator) external onlyOwner {
    operator = newOperator;
  }

  function record(
    bytes32 depositId,
    bytes32 depositNoticeHash,
    bytes32 reserveAttestationHash,
    bytes32 complianceDecisionHash,
    bytes32 aiOutputHash
  ) external {
    if (msg.sender != operator) revert NotOperator(msg.sender);

    auditByDepositId[depositId] = AuditEntry({
      depositNoticeHash: depositNoticeHash,
      reserveAttestationHash: reserveAttestationHash,
      complianceDecisionHash: complianceDecisionHash,
      aiOutputHash: aiOutputHash,
      updatedAt: uint64(block.timestamp),
      updater: msg.sender
    });

    emit AuditRecorded(
      depositId,
      depositNoticeHash,
      reserveAttestationHash,
      complianceDecisionHash,
      aiOutputHash,
      msg.sender
    );
  }
}
