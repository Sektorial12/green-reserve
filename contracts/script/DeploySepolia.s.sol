pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {GreenReserveTokenA} from "../src/GreenReserveTokenA.sol";
import {GreenReserveIssuer} from "../src/GreenReserveIssuer.sol";
import {GreenReserveCCIPSender} from "../src/GreenReserveCCIPSender.sol";

contract DeploySepolia is Script {
  address internal constant SEPOLIA_ROUTER = 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59;
  uint64 internal constant BASE_SEPOLIA_CHAIN_SELECTOR = 10344971235874465080;

  function run() external {
    uint256 privateKey = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(privateKey);
    address operator = vm.envOr("WORKFLOW_OPERATOR", deployer);

    address destReceiver = vm.envAddress("BASE_RECEIVER");
    uint256 gasLimit = vm.envOr("CCIP_GAS_LIMIT", uint256(300_000));

    vm.startBroadcast(privateKey);

    GreenReserveTokenA tokenA = new GreenReserveTokenA("GreenReserve TokenA", "GRA", deployer);
    GreenReserveIssuer issuer = new GreenReserveIssuer(address(tokenA), deployer, operator);
    tokenA.setMinter(address(issuer));

    GreenReserveCCIPSender sender = new GreenReserveCCIPSender(
      SEPOLIA_ROUTER,
      BASE_SEPOLIA_CHAIN_SELECTOR,
      destReceiver,
      deployer,
      operator,
      gasLimit
    );

    vm.stopBroadcast();

    console2.log("deployer", deployer);
    console2.log("operator", operator);
    console2.log("tokenA", address(tokenA));
    console2.log("issuer", address(issuer));
    console2.log("sender", address(sender));
    console2.log("destReceiver", destReceiver);
  }
}
