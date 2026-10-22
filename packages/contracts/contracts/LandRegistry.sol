// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract LandRegistry is ERC721, ERC721URIStorage, AccessControl {
    bytes32 public constant GOVERNMENT_ROLE = keccak256("GOVERNMENT_ROLE");
    uint256 private _nextTokenId = 1;
    enum SaleState { NONE, LOCKED, COMPLETED, CANCELLED }
    struct Parcel { string plotId; bytes32 documentHash; string ipfsCid; bool verified; SaleState saleState; bytes32 activeTransferId; }
    mapping(uint256 => Parcel) public parcels;
    mapping(string => uint256) public plotToToken;
    mapping(bytes32 => uint256) public transferToken;
    event ParcelRegistered(uint256 indexed tokenId, string plotId, address indexed to, bytes32 documentHash);
    event ParcelVerified(uint256 indexed tokenId, address indexed verifier);
    event ParcelTransferred(uint256 indexed tokenId, address indexed from, address indexed to);
    event SaleLocked(bytes32 indexed transferId, uint256 indexed tokenId, address indexed seller, address buyer);
    event SaleSettled(bytes32 indexed transferId, uint256 indexed tokenId, address seller, address buyer);
    event SaleCancelled(bytes32 indexed transferId, uint256 indexed tokenId);

    constructor(address admin) ERC721("BlockLand Parcel", "BLAND") { _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(GOVERNMENT_ROLE, admin); }
    function registerParcel(address to, string calldata plotId, string calldata uri, bytes32 documentHash, string calldata ipfsCid) external onlyRole(GOVERNMENT_ROLE) returns (uint256 tokenId) { require(plotToToken[plotId] == 0, "plot already registered"); tokenId = _nextTokenId++; _safeMint(to, tokenId); _setTokenURI(tokenId, uri); parcels[tokenId] = Parcel(plotId, documentHash, ipfsCid, true, SaleState.NONE, bytes32(0)); plotToToken[plotId] = tokenId; emit ParcelRegistered(tokenId, plotId, to, documentHash); emit ParcelVerified(tokenId, msg.sender); }
    function lockSale(bytes32 transferId, uint256 tokenId, address buyer) external onlyRole(GOVERNMENT_ROLE) { require(ownerOf(tokenId) != address(0), "parcel missing"); require(parcels[tokenId].saleState == SaleState.NONE, "sale already active"); parcels[tokenId].saleState = SaleState.LOCKED; parcels[tokenId].activeTransferId = transferId; transferToken[transferId] = tokenId; emit SaleLocked(transferId, tokenId, ownerOf(tokenId), buyer); }
    function settleSale(bytes32 transferId, address from, address to) external onlyRole(GOVERNMENT_ROLE) { uint256 tokenId = transferToken[transferId]; require(tokenId != 0, "transfer missing"); require(parcels[tokenId].activeTransferId == transferId, "wrong transfer"); require(parcels[tokenId].saleState == SaleState.LOCKED, "sale not locked"); require(ownerOf(tokenId) == from, "not owner"); _safeTransfer(from, to, tokenId, ""); parcels[tokenId].saleState = SaleState.COMPLETED; delete parcels[tokenId].activeTransferId; emit ParcelTransferred(tokenId, from, to); emit SaleSettled(transferId, tokenId, from, to); }
    function cancelSale(bytes32 transferId) external onlyRole(GOVERNMENT_ROLE) { uint256 tokenId = transferToken[transferId]; require(tokenId != 0, "transfer missing"); require(parcels[tokenId].saleState == SaleState.LOCKED, "sale not locked"); parcels[tokenId].saleState = SaleState.NONE; delete parcels[tokenId].activeTransferId; emit SaleCancelled(transferId, tokenId); }
    function transferParcel(address from, address to, uint256 tokenId) external onlyRole(GOVERNMENT_ROLE) { require(parcels[tokenId].saleState == SaleState.NONE, "sale locked"); require(ownerOf(tokenId) == from, "not owner"); _safeTransfer(from, to, tokenId, ""); emit ParcelTransferred(tokenId, from, to); }
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) { return super.tokenURI(tokenId); }
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage, AccessControl) returns (bool) { return super.supportsInterface(interfaceId); }
}
