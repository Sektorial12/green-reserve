pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {CREReportReceiverAdapter} from "../src/CREReportReceiverAdapter.sol";
import {GreenReserveAuditRegistry} from "../src/GreenReserveAuditRegistry.sol";
import {GreenReserveCCIPSender} from "../src/GreenReserveCCIPSender.sol";
import {GreenReserveIssuer} from "../src/GreenReserveIssuer.sol";
import {GreenReserveTokenA} from "../src/GreenReserveTokenA.sol";

contract RedeploySepoliaWorkflowStack is Script {
  address internal constant DEFAULT_SEPOLIA_ROUTER = 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59;
  uint64 internal constant DEFAULT_BASE_SEPOLIA_CHAIN_SELECTOR = 10344971235874465080;

  struct DeployConfig {
    address deployer;
    address baseReceiver;
    address forwarder;
    address existingTokenA;
    address router;
    uint64 destChainSelector;
    uint256 gasLimit;
    bool reusingTokenA;
  }

  struct DeployResult {
    address tokenA;
    address issuer;
    address issuerAdapter;
    address sender;
    address senderAdapter;
    address auditRegistry;
    address auditRegistryAdapter;
  }

  function _readConfig(uint256 privateKey) internal returns (DeployConfig memory cfg) {
    cfg.deployer = vm.addr(privateKey);
    cfg.baseReceiver = vm.envAddress("BASE_RECEIVER");
    cfg.forwarder = vm.envAddress("CRE_FORWARDER");
    cfg.existingTokenA = vm.envOr("TOKEN_A", address(0));
    cfg.router = vm.envOr("SEPOLIA_ROUTER", DEFAULT_SEPOLIA_ROUTER);
    cfg.destChainSelector = uint64(vm.envOr("DEST_CHAIN_SELECTOR", uint256(DEFAULT_BASE_SEPOLIA_CHAIN_SELECTOR)));
    cfg.gasLimit = vm.envOr("CCIP_GAS_LIMIT", uint256(300_000));
    cfg.reusingTokenA = cfg.existingTokenA != address(0);
  }

  function _deploy(DeployConfig memory cfg) internal returns (DeployResult memory result) {
    GreenReserveTokenA tokenA;
    if (cfg.reusingTokenA) {
      tokenA = GreenReserveTokenA(cfg.existingTokenA);
    } else {
      tokenA = new GreenReserveTokenA("GreenReserve TokenA", "GRA", cfg.deployer);
    }

    GreenReserveIssuer issuer = new GreenReserveIssuer(address(tokenA), cfg.deployer, cfg.deployer);
    GreenReserveCCIPSender sender = new GreenReserveCCIPSender(
      cfg.router,
      cfg.destChainSelector,
      cfg.baseReceiver,
      cfg.deployer,
      cfg.deployer,
      cfg.gasLimit
    );
    GreenReserveAuditRegistry auditRegistry = new GreenReserveAuditRegistry(cfg.deployer, cfg.deployer);

    CREReportReceiverAdapter issuerAdapter = new CREReportReceiverAdapter(
      cfg.forwarder,
      address(issuer),
      GreenReserveIssuer.mint.selector
    );
    CREReportReceiverAdapter senderAdapter = new CREReportReceiverAdapter(
      cfg.forwarder,
      address(sender),
      GreenReserveCCIPSender.send.selector
    );
    CREReportReceiverAdapter auditRegistryAdapter = new CREReportReceiverAdapter(
      cfg.forwarder,
      address(auditRegistry),
      GreenReserveAuditRegistry.record.selector
    );

    tokenA.setMinter(address(issuer));

    issuer.setOperator(address(issuerAdapter));
    issuer.setAuditRegistry(address(auditRegistry));

    sender.setOperator(address(senderAdapter));
    sender.setAuditRegistry(address(auditRegistry));

    auditRegistry.setOperator(address(auditRegistryAdapter));

    result = DeployResult({
      tokenA: address(tokenA),
      issuer: address(issuer),
      issuerAdapter: address(issuerAdapter),
      sender: address(sender),
      senderAdapter: address(senderAdapter),
      auditRegistry: address(auditRegistry),
      auditRegistryAdapter: address(auditRegistryAdapter)
    });
  }

  function _logDeployment(DeployConfig memory cfg, DeployResult memory result) internal {
    console2.log("deployer", cfg.deployer);
    console2.log("creForwarder", cfg.forwarder);
    console2.log("baseReceiver", cfg.baseReceiver);
    console2.log("sepoliaRouter", cfg.router);
    console2.log("destChainSelector", uint256(cfg.destChainSelector));
    console2.log("ccipGasLimit", cfg.gasLimit);
    console2.log("tokenAReused", cfg.reusingTokenA);
    console2.log("tokenA", result.tokenA);
    console2.log("issuer", result.issuer);
    console2.log("issuerWriteReceiver", result.issuerAdapter);
    console2.log("sender", result.sender);
    console2.log("senderWriteReceiver", result.senderAdapter);
    console2.log("auditRegistry", result.auditRegistry);
    console2.log("auditRegistryWriteReceiver", result.auditRegistryAdapter);
    console2.log("next.baseReceiverAllowlistSender", result.sender);
    console2.log("next.runBaseReceiverConfigScript", true);
    console2.log("config.sepoliaTokenAAddress", result.tokenA);
    console2.log("config.sepoliaIssuerAddress", result.issuer);
    console2.log("config.sepoliaIssuerWriteReceiverAddress", result.issuerAdapter);
    console2.log("config.sepoliaSenderAddress", result.sender);
    console2.log("config.sepoliaSenderWriteReceiverAddress", result.senderAdapter);
    console2.log("config.sepoliaAuditRegistryAddress", result.auditRegistry);
    console2.log("config.sepoliaAuditRegistryWriteReceiverAddress", result.auditRegistryAdapter);
  }

  function run() external {
    uint256 privateKey = vm.envUint("PRIVATE_KEY");
    DeployConfig memory cfg = _readConfig(privateKey);

    vm.startBroadcast(privateKey);
    DeployResult memory result = _deploy(cfg);

    vm.stopBroadcast();
    _logDeployment(cfg, result);
  }
}
