// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

contract MinimalIntentVerifier {
    struct ExecutionIntent {
        address account;
        address target;
        uint256 value;
        bytes32 dataHash;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 private immutable DOMAIN_SEPARATOR;

    bytes32 private constant INTENT_TYPEHASH = keccak256(
        "ExecutionIntent(address account,address target,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline)"
    );

    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    mapping(address account => mapping(address signer => mapping(uint256 nonce => bool))) public usedNonces;

    event IntentExecuted(address indexed account, address indexed signer, uint256 nonce);

    error TargetMismatch();
    error ValueMismatch();
    error DataHashMismatch();
    error IntentExpired();
    error NonceAlreadyUsed();
    error InvalidSignature();

    constructor() {
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("ExecutionBoundIntent"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    function verifyAndConsume(
        ExecutionIntent calldata intent,
        address signer,
        bytes calldata signature,
        address target,
        uint256 value,
        bytes calldata callData
    ) external {
        if (intent.target   != target)              revert TargetMismatch();
        if (intent.value    != value)               revert ValueMismatch();
        if (intent.dataHash != keccak256(callData)) revert DataHashMismatch();
        if (intent.deadline != 0 && block.timestamp > intent.deadline) revert IntentExpired();
        if (usedNonces[intent.account][signer][intent.nonce]) revert NonceAlreadyUsed();

        usedNonces[intent.account][signer][intent.nonce] = true;

        bytes32 digest = keccak256(abi.encodePacked(
            hex"1901",
            DOMAIN_SEPARATOR,
            keccak256(abi.encode(
                INTENT_TYPEHASH,
                intent.account,
                intent.target,
                intent.value,
                intent.dataHash,
                intent.nonce,
                intent.deadline
            ))
        ));

        address recovered = _recover(digest, signature);
        if (recovered != signer) revert InvalidSignature();

        emit IntentExecuted(intent.account, signer, intent.nonce);
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "bad sig length");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(digest, v, r, s);
    }

    function domainSeparator() external view returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }

    // Expose intent digest for SDK parity testing.
    // Returns the same digest the SDK computes via hashIntent().
    function intentDigest(
        address account,
        address target,
        uint256 value,
        bytes32 dataHash_,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bytes32) {
        return keccak256(abi.encodePacked(
            hex"1901",
            DOMAIN_SEPARATOR,
            keccak256(abi.encode(
                INTENT_TYPEHASH,
                account,
                target,
                value,
                dataHash_,
                nonce,
                deadline
            ))
        ));
    }
}
