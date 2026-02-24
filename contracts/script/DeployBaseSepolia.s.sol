pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {GreenReserveTokenB} from "../src/GreenReserveTokenB.sol";
import {GreenReserveReceiver} from "../src/GreenReserveReceiver.sol";

contract DeployBaseSepolia is Script {
  address internal constant BASE_SEPOLIA_ROUTER = 0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93;
  uint64 internal constant SEPOLIA_CHAIN_SELECTOR = 16015286601757825753;

  function run() external {
    uint256 privateKey = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(privateKey);

    vm.startBroadcast(privateKey);

    GreenReserveTokenB tokenB = new GreenReserveTokenB("GreenReserve TokenB", "GRB", deployer);
    GreenReserveReceiver receiver = new GreenReserveReceiver(BASE_SEPOLIA_ROUTER, address(tokenB), deployer);

    tokenB.setMinter(address(receiver));
    receiver.setAllowlistedSourceChain(SEPOLIA_CHAIN_SELECTOR, true);

    vm.stopBroadcast();

    console2.log("deployer", deployer);
    console2.log("tokenB", address(tokenB));
    console2.log("receiver", address(receiver));
  }
}
