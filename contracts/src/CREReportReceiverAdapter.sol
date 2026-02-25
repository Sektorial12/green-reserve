pragma solidity ^0.8.24;

contract CREReportReceiverAdapter {
  address public immutable forwarder;
  address public immutable target;
  bytes4 public immutable expectedSelector;

  error NotForwarder(address caller);

  constructor(address forwarder_, address target_, bytes4 expectedSelector_) {
    forwarder = forwarder_;
    target = target_;
    expectedSelector = expectedSelector_;
  }

  function onReport(bytes calldata report, bytes calldata callData) external {
    if (msg.sender != forwarder) revert NotForwarder(msg.sender);

    (bool ok, bytes memory returndata) = _tryForward(callData);
    if (!ok) {
      (ok, returndata) = _tryForward(report);
    }
    if (!ok) {
      assembly {
        revert(add(returndata, 0x20), mload(returndata))
      }
    }
  }

  function onReport(bytes32, bytes calldata callData) external {
    if (msg.sender != forwarder) revert NotForwarder(msg.sender);

    (bool ok, bytes memory returndata) = _tryForward(callData);
    if (!ok) {
      assembly {
        revert(add(returndata, 0x20), mload(returndata))
      }
    }
  }

  function _tryForward(bytes calldata callData) private returns (bool ok, bytes memory returndata) {
    (ok, returndata) = target.call(callData);

    if (!ok) {
      uint256 idx = _indexOfSelector(callData, expectedSelector, 0);
      while (idx != type(uint256).max) {
        if (idx != 0) {
          bytes calldata sliced = callData[idx:];
          (ok, returndata) = target.call(sliced);
          if (ok) return (ok, returndata);
        }

        unchecked {
          idx = _indexOfSelector(callData, expectedSelector, idx + 1);
        }
      }
    }

    return (ok, returndata);
  }

  function _indexOfSelector(bytes calldata data, bytes4 selector, uint256 start) private pure returns (uint256) {
    if (data.length < 4) return type(uint256).max;
    if (start + 4 > data.length) return type(uint256).max;

    uint32 needle = uint32(uint256(bytes32(selector)) >> 224);

    for (uint256 i = start; i + 4 <= data.length; i++) {
      uint32 word;
      assembly {
        word := shr(224, calldataload(add(data.offset, i)))
      }
      if (word == needle) return i;
    }

    return type(uint256).max;
  }
}
