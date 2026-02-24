pragma solidity ^0.8.24;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

contract GreenReserveTokenA is ERC20, Ownable {
  address public minter;

  error NotMinter(address caller);

  constructor(string memory name_, string memory symbol_, address initialOwner) ERC20(name_, symbol_) Ownable(initialOwner) {
    minter = address(0);
  }

  function setMinter(address newMinter) external onlyOwner {
    minter = newMinter;
  }

  function mint(address to, uint256 amount) external {
    if (msg.sender != minter) revert NotMinter(msg.sender);
    _mint(to, amount);
  }
}
