pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {CREReportReceiverAdapter} from "../src/CREReportReceiverAdapter.sol";

contract DeploySepoliaAdapters is Script {
  function run() external {
    uint256 privateKey = vm.envUint("PRIVATE_KEY");

    address forwarder = vm.envAddress("CRE_FORWARDER");
    address issuer = vm.envAddress("ISSUER");
    address sender = vm.envAddress("SENDER");

    vm.startBroadcast(privateKey);

    bytes4 issuerSelector = 0x1e458bee; // mint(address,uint256,bytes32)
    bytes4 senderSelector = 0xb19f4284; // send(address,uint256,bytes32)

    CREReportReceiverAdapter issuerAdapter = new CREReportReceiverAdapter(forwarder, issuer, issuerSelector);
    CREReportReceiverAdapter senderAdapter = new CREReportReceiverAdapter(forwarder, sender, senderSelector);

    vm.stopBroadcast();

    console2.log("issuerAdapter", address(issuerAdapter));
    console2.log("senderAdapter", address(senderAdapter));
  }
}
