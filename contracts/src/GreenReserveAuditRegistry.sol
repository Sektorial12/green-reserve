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

  struct AiAuditEntry {
    bytes32 memoSha256;
    bytes32 inputSha256;
    bytes32 modelHash;
    bytes32 promptVersionHash;
    uint16 confidenceBps;
    uint64 createdAt;
    uint8 decision;
    bytes32 externalRssSha256;
    bytes32 externalJsonSha256;
  }

  mapping(bytes32 depositId => AuditEntry entry) public auditByDepositId;
  mapping(bytes32 depositId => AiAuditEntry entry) public aiAuditByDepositId;

  error NotOperator(address caller);

  event AuditRecorded(
    bytes32 indexed depositId,
    bytes32 depositNoticeHash,
    bytes32 reserveAttestationHash,
    bytes32 complianceDecisionHash,
    bytes32 aiOutputHash,
    address indexed updater
  );

  event AiAuditRecorded(
    bytes32 indexed depositId,
    bytes32 memoSha256,
    bytes32 inputSha256,
    bytes32 modelHash,
    bytes32 promptVersionHash,
    uint16 confidenceBps,
    uint64 createdAt,
    uint8 decision,
    bytes32 externalRssSha256,
    bytes32 externalJsonSha256,
    address indexed updater
  );

  constructor(address initialOwner, address initialOperator) Ownable(initialOwner) {
    operator = initialOperator;
  }

  function setOperator(address newOperator) external onlyOwner {
    operator = newOperator;
  }

  function _recordBaseAudit(
    bytes32 depositId,
    bytes32 depositNoticeHash,
    bytes32 reserveAttestationHash,
    bytes32 complianceDecisionHash,
    bytes32 aiOutputHash
  ) internal {
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

  function _recordAiAudit(
    bytes32 depositId,
    bytes32[6] calldata aiHashes,
    uint64[3] calldata aiMetrics
  ) internal {
    aiAuditByDepositId[depositId] = AiAuditEntry({
      memoSha256: aiHashes[0],
      inputSha256: aiHashes[1],
      modelHash: aiHashes[2],
      promptVersionHash: aiHashes[3],
      confidenceBps: uint16(aiMetrics[0]),
      createdAt: aiMetrics[1],
      decision: uint8(aiMetrics[2]),
      externalRssSha256: aiHashes[4],
      externalJsonSha256: aiHashes[5]
    });

    emit AiAuditRecorded(
      depositId,
      aiHashes[0],
      aiHashes[1],
      aiHashes[2],
      aiHashes[3],
      uint16(aiMetrics[0]),
      aiMetrics[1],
      uint8(aiMetrics[2]),
      aiHashes[4],
      aiHashes[5],
      msg.sender
    );
  }

  function record(
    bytes32 depositId,
    bytes32 depositNoticeHash,
    bytes32 reserveAttestationHash,
    bytes32 complianceDecisionHash,
    bytes32 aiOutputHash,
    bytes32[6] calldata aiHashes,
    uint64[3] calldata aiMetrics
  ) external {
    if (msg.sender != operator) revert NotOperator(msg.sender);

    _recordBaseAudit(depositId, depositNoticeHash, reserveAttestationHash, complianceDecisionHash, aiOutputHash);
    _recordAiAudit(depositId, aiHashes, aiMetrics);
  }
}
