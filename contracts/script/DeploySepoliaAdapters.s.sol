pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {CREReportReceiverAdapter} from "../src/CREReportReceiverAdapter.sol";
import {GreenReserveAuditRegistry} from "../src/GreenReserveAuditRegistry.sol";

contract DeploySepoliaAdapters is Script {
  function run() external {
    uint256 privateKey = vm.envUint("PRIVATE_KEY");

    address forwarder = vm.envAddress("CRE_FORWARDER");
    address issuer = vm.envAddress("ISSUER");
    address sender = vm.envAddress("SENDER");
    address auditRegistry = vm.envOr("AUDIT_REGISTRY", address(0));

    vm.startBroadcast(privateKey);

    bytes4 issuerSelector = 0x1e458bee; // mint(address,uint256,bytes32)
    bytes4 senderSelector = 0xb19f4284; // send(address,uint256,bytes32)

    CREReportReceiverAdapter issuerAdapter = new CREReportReceiverAdapter(forwarder, issuer, issuerSelector);
    CREReportReceiverAdapter senderAdapter = new CREReportReceiverAdapter(forwarder, sender, senderSelector);
    CREReportReceiverAdapter auditRegistryAdapter;

    if (auditRegistry != address(0)) {
      bytes4 auditRegistrySelector = GreenReserveAuditRegistry.record.selector;
      auditRegistryAdapter = new CREReportReceiverAdapter(forwarder, auditRegistry, auditRegistrySelector);
    }

    vm.stopBroadcast();

    console2.log("creForwarder", forwarder);
    console2.log("issuer", issuer);
    console2.log("issuerAdapter", address(issuerAdapter));
    console2.log("sender", sender);
    console2.log("senderAdapter", address(senderAdapter));
    console2.log("auditRegistry", auditRegistry);
    if (auditRegistry != address(0)) {
      console2.log("auditRegistryAdapter", address(auditRegistryAdapter));
    }
    console2.log("config.sepoliaIssuerWriteReceiverAddress", address(issuerAdapter));
    console2.log("config.sepoliaSenderWriteReceiverAddress", address(senderAdapter));
    if (auditRegistry != address(0)) {
      console2.log("config.sepoliaAuditRegistryWriteReceiverAddress", address(auditRegistryAdapter));
    }
  }
}
