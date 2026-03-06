pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {GreenReserveReceiver} from "../src/GreenReserveReceiver.sol";
import {GreenReserveTokenB} from "../src/GreenReserveTokenB.sol";

contract RedeployBaseSepoliaReceiver is Script {
  address internal constant DEFAULT_BASE_SEPOLIA_ROUTER = 0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93;
  uint64 internal constant DEFAULT_SEPOLIA_CHAIN_SELECTOR = 16015286601757825753;

  function run() external {
    uint256 privateKey = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(privateKey);

    address tokenBAddress = vm.envAddress("BASE_TOKEN_B");
    address sepoliaSender = vm.envAddress("SEPOLIA_SENDER");
    address router = vm.envOr("BASE_ROUTER", DEFAULT_BASE_SEPOLIA_ROUTER);
    uint64 sepoliaChainSelector = uint64(vm.envOr("SEPOLIA_CHAIN_SELECTOR", uint256(DEFAULT_SEPOLIA_CHAIN_SELECTOR)));

    vm.startBroadcast(privateKey);

    GreenReserveTokenB tokenB = GreenReserveTokenB(tokenBAddress);
    GreenReserveReceiver receiver = new GreenReserveReceiver(router, address(tokenB), deployer);

    tokenB.setMinter(address(receiver));
    receiver.setAllowlistedSourceChain(sepoliaChainSelector, true);
    receiver.setAllowlistedSender(sepoliaSender, true);

    vm.stopBroadcast();

    console2.log("deployer", deployer);
    console2.log("baseRouter", router);
    console2.log("sepoliaChainSelector", uint256(sepoliaChainSelector));
    console2.log("tokenB", tokenBAddress);
    console2.log("receiver", address(receiver));
    console2.log("allowlistedSender", sepoliaSender);
    console2.log("config.baseSepoliaTokenBAddress", tokenBAddress);
    console2.log("config.baseSepoliaReceiverAddress", address(receiver));
  }
}
