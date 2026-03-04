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

    vm.startBroadcast(privateKey);

    GreenReserveIssuer issuer = GreenReserveIssuer(issuerAddress);
    issuer.setOperator(issuerOperator);

    GreenReserveCCIPSender sender = GreenReserveCCIPSender(payable(senderAddress));
    sender.setOperator(senderOperator);

    vm.stopBroadcast();

    console2.log("deployer", deployer);
    console2.log("issuer", issuerAddress);
    console2.log("issuerOperator", issuerOperator);
    console2.log("sender", senderAddress);
    console2.log("senderOperator", senderOperator);
  }
}
