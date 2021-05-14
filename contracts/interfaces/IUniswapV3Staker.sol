// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

interface IUniswapV3Staker {
    event IncentiveCreated(
        address indexed rewardToken,
        address indexed pool,
        uint32 startTime,
        uint32 endTime,
        uint32 claimDeadline,
        uint128 indexed totalReward
    );
    event IncentiveEnded(
        address indexed rewardToken,
        address indexed pool,
        uint32 startTime,
        uint32 endTime
    );
    event TokenDeposited(uint256 tokenId);
    event TokenWithdrawn(uint256 tokenId);
    // TODO params.
    event TokenUnstaked();
    event TokenStaked();

    /**
    @param rewardToken The token being distributed as a reward
    @param pool The Uniswap V3 pool
    @param startTime When rewards should begin accruing
    @param endTime When rewards stop accruing
    @param claimDeadline When program should expire
    @param totalReward Total reward to be distributed
    */

    struct CreateIncentiveParams {
        address rewardToken;
        address pool;
        uint32 startTime;
        uint32 endTime;
        uint32 claimDeadline;
        uint128 totalReward;
    }

    /**
    @notice Creates a new liquidity mining incentive program.
    */
    function createIncentive(CreateIncentiveParams memory params) external;

    struct EndIncentiveParams {
        address rewardToken;
        address pool;
        uint32 startTime;
        uint32 endTime;
        uint32 claimDeadline;
    }

    /**
    @notice Deletes an incentive whose claimDeadline has passed.
    */
    function endIncentive(EndIncentiveParams memory params) external;
}
