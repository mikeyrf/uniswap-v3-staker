import { ContractFactory, BigNumber, Wallet } from 'ethers'
import { MockProvider } from 'ethereum-waffle'
import {
  blockTimestamp,
  BNe18,
  FeeAmount,
  getCurrentTick,
  maxGas,
  MaxUint256,
  encodePath,
  arrayWrap,
  log,
} from '../shared/index'
import _, { isArray } from 'lodash'
import {
  TestERC20,
  INonfungiblePositionManager,
  UniswapV3Staker,
  IUniswapV3Pool,
} from '../../typechain'
import { HelperTypes } from './types'
import { ActorFixture } from '../shared/actors'
import { mintPosition } from '../shared/fixtures'
import UniswapV3Pool from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json'
import { ISwapRouter } from '../../types/ISwapRouter'
import { ethers } from 'hardhat'
import { ContractParams } from '../../types/contractParams'

/**
 * HelperCommands is a utility that abstracts away lower-level ethereum details
 * so that we can focus on core business logic.
 *
 * Each helper function should be a `HelperTypes.CommandFunction`
 */
export class HelperCommands {
  actors: ActorFixture
  provider: MockProvider
  staker: UniswapV3Staker
  nft: INonfungiblePositionManager
  router: ISwapRouter
  pool: IUniswapV3Pool

  DEFAULT_INCENTIVE_DURATION = 2_000
  DEFAULT_CLAIM_DURATION = 1_000

  constructor({
    provider,
    staker,
    nft,
    router,
    pool,
    actors,
  }: {
    provider: MockProvider
    staker: UniswapV3Staker
    nft: INonfungiblePositionManager
    router: ISwapRouter
    pool: IUniswapV3Pool
    actors: ActorFixture
  }) {
    this.actors = actors
    this.provider = provider
    this.staker = staker
    this.nft = nft
    this.router = router
    this.pool = pool
  }

  /**
   * Creates a staking incentive owned by `incentiveCreator` for `totalReward` of `rewardToken`
   *
   * Side-Effects:
   *  Transfers `rewardToken` to `incentiveCreator` if they do not have sufficient blaance.
   */
  createIncentiveFlow: HelperTypes.CreateIncentive.Command = async (params) => {
    const { startTime } = params
    const endTime =
      params.endTime || startTime + this.DEFAULT_INCENTIVE_DURATION
    const claimDeadline =
      params.claimDeadline || endTime + this.DEFAULT_CLAIM_DURATION

    const incentiveCreator = this.actors.incentiveCreator()
    const times = {
      startTime,
      endTime,
      claimDeadline,
    }
    const bal = await params.rewardToken.balanceOf(incentiveCreator.address)

    if (bal < params.totalReward) {
      await params.rewardToken.transfer(
        incentiveCreator.address,
        params.totalReward
      )
    }

    await params.rewardToken
      .connect(incentiveCreator)
      .approve(this.staker.address, params.totalReward)

    await this.staker.connect(incentiveCreator).createIncentive({
      pool: params.poolAddress,
      rewardToken: params.rewardToken.address,
      totalReward: params.totalReward,
      ...times,
    })

    return {
      ..._.pick(params, ['poolAddress', 'totalReward', 'rewardToken']),
      ...times,
      creatorAddress: incentiveCreator.address,
    }
  }

  /**
   * params.lp mints an NFT backed by a certain amount of `params.tokensToStake`.
   *
   * Side-Effects:
   *  Funds `params.lp` with enough `params.tokensToStake` if they do not have enough.
   *  Handles the ERC20 and ERC721 permits.
   */
  mintDepositStakeFlow: HelperTypes.MintStake.Command = async (params) => {
    // Make sure LP has enough balance
    const tokensOwner = this.actors.tokensOwner()
    const bal0 = await params.tokensToStake[0].balanceOf(params.lp.address)
    if (bal0 < params.amountsToStake[0])
      await params.tokensToStake[0]
        // .connect(tokensOwner)
        .transfer(params.lp.address, params.amountsToStake[0])

    const bal1 = await params.tokensToStake[1].balanceOf(params.lp.address)
    if (bal1 < params.amountsToStake[1])
      await params.tokensToStake[1]
        // .connect(tokensOwner)
        .transfer(params.lp.address, params.amountsToStake[1])

    // Make sure LP has authorized NFT to withdraw
    await params.tokensToStake[0]
      .connect(params.lp)
      .approve(this.nft.address, params.amountsToStake[0])
    await params.tokensToStake[1]
      .connect(params.lp)
      .approve(this.nft.address, params.amountsToStake[1])

    // The LP mints their NFT
    const tokenId = await mintPosition(this.nft.connect(params.lp), {
      token0: params.tokensToStake[0].address,
      token1: params.tokensToStake[1].address,
      fee: FeeAmount.MEDIUM,
      tickLower: params.ticks[0],
      tickUpper: params.ticks[1],
      recipient: params.lp.address,
      amount0Desired: params.amountsToStake[0],
      amount1Desired: params.amountsToStake[1],
      amount0Min: 0,
      amount1Min: 0,
      deadline: (await blockTimestamp()) + 1000,
    })

    // Make sure LP has authorized staker
    await params.tokensToStake[0]
      .connect(params.lp)
      .approve(this.staker.address, params.amountsToStake[0])
    await params.tokensToStake[1]
      .connect(params.lp)
      .approve(this.staker.address, params.amountsToStake[1])

    // The LP approves and stakes their NFT

    await this.nft.connect(params.lp).approve(this.staker.address, tokenId)
    await this.staker.connect(params.lp).depositToken(tokenId, maxGas)
    await this.staker.connect(params.lp).stakeToken({
      ...incentiveResultToStakeAdapter({
        ...params.createIncentiveResult,
        tokenId,
      }),
      rewardToken: params.createIncentiveResult.rewardToken.address,
    })

    const stakedAt = await blockTimestamp()

    return {
      tokenId,
      stakedAt,
      lp: params.lp,
    }
  }

  unstakeCollectBurnFlow: HelperTypes.UnstakeCollectBurn.Command = async (
    params
  ) => {
    await this.staker.connect(params.lp).unstakeToken(
      {
        ...incentiveResultToStakeAdapter({
          ...params.createIncentiveResult,
          tokenId: params.tokenId,
        }),
        rewardToken: params.createIncentiveResult.rewardToken.address,
      },
      maxGas
    )

    const unstakedAt = await blockTimestamp()

    await this.staker
      .connect(params.lp)
      .claimReward(
        params.createIncentiveResult.rewardToken.address,
        params.lp.address
      )

    await this.staker
      .connect(params.lp)
      .withdrawToken(params.tokenId, params.lp.address, maxGas)

    const { liquidity } = await this.nft
      .connect(params.lp)
      .positions(params.tokenId)

    await this.nft.connect(params.lp).decreaseLiquidity(
      {
        tokenId: params.tokenId,
        liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: (await blockTimestamp()) + 1000,
      },
      maxGas
    )

    const { tokensOwed0, tokensOwed1 } = await this.nft
      .connect(params.lp)
      .positions(params.tokenId)

    await this.nft.connect(params.lp).collect(
      {
        tokenId: params.tokenId,
        recipient: params.lp.address,
        amount0Max: tokensOwed0,
        amount1Max: tokensOwed1,
      },
      maxGas
    )

    await this.nft.connect(params.lp).burn(params.tokenId, maxGas)

    const balance = await params.createIncentiveResult.rewardToken
      .connect(params.lp)
      .balanceOf(params.lp.address)

    return {
      balance,
      unstakedAt,
    }
  }

  endIncentiveFlow: HelperTypes.EndIncentive.Command = async (params) => {
    const incentiveCreator = this.actors.incentiveCreator()
    const { rewardToken } = params.createIncentiveResult

    const receipt = await (
      await this.staker.connect(incentiveCreator).endIncentive(
        _.assign(
          {},
          _.pick(params.createIncentiveResult, [
            'startTime',
            'endTime',
            'claimDeadline',
          ]),
          {
            rewardToken: rewardToken.address,
            pool: params.createIncentiveResult.poolAddress,
          }
        )
      )
    ).wait()

    const transferFilter = rewardToken.filters.Transfer(
      this.staker.address,
      incentiveCreator.address,
      null
    )
    const transferTopic = rewardToken.interface.getEventTopic('Transfer')
    const log = receipt.logs.find((log) => log.topics.includes(transferTopic))
    const events = await rewardToken.queryFilter(transferFilter, log?.blockHash)
    let amountTransferred: BigNumber

    if (events.length === 1) {
      amountTransferred = events[0].args[2]
    } else {
      throw new Error('Could not find transfer event')
    }

    return {
      amountReturnedToCreator: amountTransferred,
    }
  }

  makeTickGoFlow: HelperTypes.MakeTickGo.Command = async (params) => {
    // await tok0.transfer(trader0.address, BNe18(2).mul(params.numberOfTrades))
    // await tok0
    //   .connect(trader0)
    //   .approve(router.address, BNe18(2).mul(params.numberOfTrades))

    const MAKE_TICK_GO_UP = params.direction === 'up'
    const actor = params.trader || this.actors.traderUser0()

    const isDone = (tick: number | undefined) => {
      if (!params.desiredValue) {
        return true
      } else if (!tick) {
        return false
      } else if (MAKE_TICK_GO_UP) {
        return tick > params.desiredValue
      } else {
        return tick < params.desiredValue
      }
    }

    const [tok0Address, tok1Address] = await Promise.all([
      this.pool.connect(actor).token0(),
      this.pool.connect(actor).token1(),
    ])
    const erc20 = await ethers.getContractFactory('TestERC20')

    const tok0 = erc20.attach(tok0Address) as TestERC20
    const tok1 = erc20.attach(tok1Address) as TestERC20

    const doTrade = async () => {
      /* If we want to push price down, we need to increase tok0.
         If we want to push price up, we need to increase tok1 */

      const amountIn = BNe18(1)

      const erc20Helper = new ERC20Helper()
      await erc20Helper.ensureBalancesAndApprovals(
        actor,
        [tok0, tok1],
        amountIn,
        this.router.address
      )

      const path = encodePath(
        MAKE_TICK_GO_UP
          ? [tok1Address, tok0Address]
          : [tok0Address, tok1Address],
        [FeeAmount.MEDIUM]
      )

      await this.router.connect(actor).exactInput(
        {
          recipient: actor.address,
          deadline: MaxUint256,
          path,
          amountIn: amountIn.div(10),
          amountOutMinimum: 0,
        },
        maxGas
      )

      return await getCurrentTick(this.pool.connect(actor))
    }

    let currentTick = await doTrade()

    while (!isDone(currentTick)) {
      currentTick = await doTrade()
    }

    return { currentTick }
  }
}

export class ERC20Helper {
  ensureBalancesAndApprovals = async (
    actor: Wallet,
    tokens: TestERC20 | Array<TestERC20>,
    balance: BigNumber,
    spender?: string
  ) => {
    for (let token of arrayWrap(tokens)) {
      await this.ensureBalance(actor, token, balance)
      if (spender) {
        await this.ensureApproval(actor, token, balance, spender)
      }
    }
  }

  ensureBalance = async (
    actor: Wallet,
    token: TestERC20,
    balance: BigNumber
  ) => {
    const currentBalance = await token.balanceOf(actor.address)
    if (currentBalance.lt(balance)) {
      await token
        // .connect(this.actors.tokensOwner())
        .transfer(actor.address, balance.sub(currentBalance))
    }

    // if (spender) {
    //   await this.ensureApproval(actor, token, balance, spender)
    // }

    return await token.balanceOf(actor.address)
  }

  ensureApproval = async (
    actor: Wallet,
    token: TestERC20,
    balance: BigNumber,
    spender: string
  ) => {
    const currentAllowance = await token.allowance(actor.address, actor.address)
    if (currentAllowance.lt(balance)) {
      await token.connect(actor).approve(spender, balance)
    }
  }
}

type IncentiveAdapterFunc = (
  params: HelperTypes.CreateIncentive.Result & { tokenId: string }
) => ContractParams.StakeToken

export const incentiveResultToStakeAdapter: IncentiveAdapterFunc = (
  params
) => ({
  tokenId: (params.tokenId as any) as number,
  startTime: params.startTime,
  endTime: params.endTime,
  claimDeadline: params.claimDeadline,
  rewardToken: params.rewardToken.address,
  creator: params.creatorAddress,
})
