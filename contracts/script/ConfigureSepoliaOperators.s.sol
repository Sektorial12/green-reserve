pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {GreenReserveIssuer} from "../src/GreenReserveIssuer.sol";
import {GreenReserveCCIPSender} from "../src/GreenReserveCCIPSender.sol";

contract ConfigureSepoliaOperators is Script {
  function run() external {
    uint256 privateKey = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(privateKey);

    address issuerAddress = vm.envAddress("ISSUER");
    address senderAddress = vm.envAddress("SENDER");
    address issuerOperator = vm.envAddress("ISSUER_OPERATOR");
    address senderOperator = vm.envAddress("SENDER_OPERATOR");
    address auditRegistry = vm.envOr("AUDIT_REGISTRY", address(0));

    vm.startBroadcast(privateKey);

    GreenReserveIssuer issuer = GreenReserveIssuer(issuerAddress);
    issuer.setOperator(issuerOperator);

    if (auditRegistry != address(0)) {
      issuer.setAuditRegistry(auditRegistry);
    }

    GreenReserveCCIPSender sender = GreenReserveCCIPSender(payable(senderAddress));
    sender.setOperator(senderOperator);

    if (auditRegistry != address(0)) {
      sender.setAuditRegistry(auditRegistry);
    }

    vm.stopBroadcast();

    console2.log("deployer", deployer);
    console2.log("issuer", issuerAddress);
    console2.log("issuerOperator", issuerOperator);
    console2.log("sender", senderAddress);
    console2.log("senderOperator", senderOperator);
    console2.log("auditRegistry", auditRegistry);
  }
}
