pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {CREReportReceiverAdapter} from "../src/CREReportReceiverAdapter.sol";
import {GreenReserveAuditRegistry} from "../src/GreenReserveAuditRegistry.sol";

contract DeploySepoliaAuditRegistry is Script {
  function run() external {
    uint256 privateKey = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(privateKey);

    address forwarder = vm.envAddress("CRE_FORWARDER");

    vm.startBroadcast(privateKey);

    GreenReserveAuditRegistry registry = new GreenReserveAuditRegistry(deployer, deployer);

    bytes4 selector = GreenReserveAuditRegistry.record.selector;
    CREReportReceiverAdapter adapter = new CREReportReceiverAdapter(forwarder, address(registry), selector);

    registry.setOperator(address(adapter));

    vm.stopBroadcast();

    console2.log("deployer", deployer);
    console2.log("creForwarder", forwarder);
    console2.log("auditRegistry", address(registry));
    console2.log("auditRegistryWriteReceiver", address(adapter));
  }
}
