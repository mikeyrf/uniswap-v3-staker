import { task } from 'hardhat/config'
import '@typechain/hardhat'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import '@nomiclabs/hardhat-etherscan'

import { HardhatUserConfig } from 'hardhat/config'

task('compile-uniswap', 'Compiles uniswap contracts', async (args, hre) => {
  const cwd = process.cwd()
  const { runTypeChain, glob } = await import('typechain')
  const allFiles = glob(cwd, [
    './node_modules/@uniswap/?(v3-core|v3-periphery)/artifacts/contracts/**/*.json',
    `${hre.config.paths.artifacts}/!(build-info)/**/+([a-zA-Z0-9_]).json`,
  ])
  const typechainCfg = hre.config?.typechain

  const config = {
    cwd,
    filesToProcess: allFiles,
    allFiles,
    outDir: typechainCfg.outDir || 'typechain',
    target: typechainCfg.target,
    flags: {
      alwaysGenerateOverloads:
        hre.config.typechain?.alwaysGenerateOverloads || true,
      environment: undefined,
    },
  }

  const result = await runTypeChain(config)
})

const DEFAULT_COMPILER_SETTINGS = {
  version: '0.7.6',
  settings: {
    optimizer: {
      enabled: true,
      runs: 1_000_000,
    },
    metadata: {
      bytecodeHash: 'none',
    },
  },
}

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${process.env.INFURA_API_KEY}`,
    },
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${process.env.INFURA_API_KEY}`,
    },
    goerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_API_KEY}`,
    },
    kovan: {
      url: `https://kovan.infura.io/v3/${process.env.INFURA_API_KEY}`,
    },
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  solidity: {
    compilers: [DEFAULT_COMPILER_SETTINGS],
  },
}

export default config
