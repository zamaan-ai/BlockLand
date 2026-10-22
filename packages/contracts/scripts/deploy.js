const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const LandRegistry = await hre.ethers.getContractFactory("LandRegistry");
  const registry = await LandRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  console.log("LandRegistry deployed to:", await registry.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
