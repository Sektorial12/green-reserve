pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {GreenReserveReceiver} from "../src/GreenReserveReceiver.sol";

contract ConfigureBaseSepoliaReceiver is Script {
  function run() external {
    uint256 privateKey = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(privateKey);

    address receiverAddress = vm.envAddress("BASE_RECEIVER");
    address sepoliaSender = vm.envAddress("SEPOLIA_SENDER");

    vm.startBroadcast(privateKey);

    GreenReserveReceiver receiver = GreenReserveReceiver(receiverAddress);
    receiver.setAllowlistedSender(sepoliaSender, true);

    vm.stopBroadcast();

    console2.log("deployer", deployer);
    console2.log("receiver", receiverAddress);
    console2.log("allowlistedSender", sepoliaSender);
  }
}
