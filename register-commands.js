require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');
const fetch = require('node-fetch');

// Add debug logging and validation
console.log('Environment variables check:');
console.log('TOKEN:', process.env.TOKEN ? 'Found' : 'Missing');
console.log('CLIENT_ID:', process.env.CLIENT_ID ? 'Found' : 'Missing');

// Validate required environment variables
if (!process.env.TOKEN) {
    console.error('❌ ERROR: TOKEN is missing from .env file!');
    process.exit(1);
}

if (!process.env.CLIENT_ID) {
    console.error('❌ ERROR: CLIENT_ID is missing from .env file!');
    process.exit(1);
}

const commands = [
    {
        name: 'set-wallet',
        description: 'Register your MultiversX wallet address for token transfers',
        options: [
            {
                name: 'wallet',
                description: 'Your MultiversX wallet address (starts with erd1)',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
        default_member_permissions: null, // This allows everyone to use the command
    },
    {
        name: 'send-esdt',
        description: 'Send ESDT tokens to a specified user (Admin only)',
        options: [
            {
                name: 'project-name',
                description: 'The project to use for this transfer',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'user-tag',
                description: 'The Discord username to send tokens to (without @ symbol)',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'token-ticker',
                description: 'The token ticker to use for this transfer',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'amount',
                description: 'The amount of tokens to transfer',
                type: ApplicationCommandOptionType.Number,
                required: true,
                min_value: 0
            },
            {
                name: 'memo',
                description: 'Optional memo or reason for the transfer',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'send-nft',
        description: 'Send NFT to a specified user (Admin only)',
        options: [
            {
                name: 'project-name',
                description: 'The project to use for this transfer',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'collection',
                description: 'The NFT collection to transfer from',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'nft-name',
                description: 'The specific NFT to transfer',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'user-tag',
                description: 'The Discord username to send NFT to (without @ symbol)',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'memo',
                description: 'Optional memo or reason for the transfer',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'create-auction',
        description: 'Create an NFT auction (Admin only)',
        options: [
            {
                name: 'source',
                description: 'NFT source: Project Wallet or Virtual Account',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Project Wallet', value: 'project_wallet' },
                    { name: 'Virtual Account', value: 'virtual_account' }
                ]
            },
            {
                name: 'collection',
                description: 'The NFT collection',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'nft-name',
                description: 'The specific NFT to auction',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'title',
                description: 'Auction title',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'description',
                description: 'Auction description',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'duration',
                description: 'Auction duration in hours',
                type: ApplicationCommandOptionType.Number,
                required: true,
                min_value: 1,
                max_value: 168
            },
            {
                name: 'token-ticker',
                description: 'Token ticker for bidding',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'starting-amount',
                description: 'Starting bid amount',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'min-bid-increase',
                description: 'Minimum bid increase amount',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'project-name',
                description: 'The project owning the NFT (required for Project Wallet source)',
                type: ApplicationCommandOptionType.String,
                required: false,
                autocomplete: true
            },
            {
                name: 'seller-id',
                description: 'Discord user ID of NFT owner (required for Virtual Account source)',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'amount',
                description: 'Amount to auction (default: 1, required for SFTs)',
                type: ApplicationCommandOptionType.Number,
                required: false,
                min_value: 1
            },
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'list-wallets',
        description: 'List registered wallets by username (Public - verify your wallet registration)',
        options: [
            {
                name: 'filter',
                description: 'Filter usernames containing this text (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
            {
                name: 'page',
                description: 'Page number (20 entries per page)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                min_value: 1
            },
            {
                name: 'public',
                description: 'Whether to make the response visible to everyone',
                type: ApplicationCommandOptionType.Boolean,
                required: false,
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'register-project',
        description: 'Register a new MultiversX project with auto-generated wallet (Admin only)',
        options: [
            {
                name: 'project-name',
                description: 'Name of the project',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'supported-tokens',
                description: 'Comma-separated list of supported token tickers (e.g., EGLD,USDC,REWARD)',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'project-logo-url',
                description: 'Project logo image URL (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
            {
                name: 'user-input',
                description: 'Additional notes or description for the project (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'update-project',
        description: 'Update specific fields of an existing project (Admin only)',
        options: [
            {
                name: 'project-name',
                description: 'Name of the project to update',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'new-project-name',
                description: 'New name for the project (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
            {
                name: 'wallet-address',
                description: 'New wallet address for the project (erd1...) (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
            {
                name: 'wallet-pem',
                description: 'New PEM file content for the project wallet (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
            {
                name: 'supported-tokens',
                description: 'Comma-separated list of supported token tickers (e.g., EGLD,USDC,REWARD) (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
            {
                name: 'project-logo-url',
                description: 'Project logo image URL (stored in projects table) (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
            {
                name: 'qr-code-url',
                description: 'Community Fund QR code URL (stored in community_fund_qr table) (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
            {
                name: 'user-input',
                description: 'New additional notes or description for the project (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'list-projects',
        description: 'List all registered projects for this server (Admin only)',
        options: [
            {
                name: 'public',
                description: 'Whether to make the response visible to everyone',
                type: ApplicationCommandOptionType.Boolean,
                required: false,
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'show-community-fund-address',
        description: 'Display the community fund wallet address and QR code for deposits',
        options: [],
        default_member_permissions: null, // Everyone can use this command
    },
    {
        name: 'delete-project',
        description: 'Delete a project from this server (Admin only)',
        options: [
            {
                name: 'project-name',
                description: 'Name of the project to delete',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'confirm',
                description: 'Type "DELETE" to confirm project deletion',
                type: ApplicationCommandOptionType.String,
                required: true,
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'delete-all-server-data',
        description: 'Delete ALL server data and perform mass refund (Admin only - Hard Reset)',
        options: [
            {
                name: 'confirm',
                description: 'Type "DELETE ALL DATA" to confirm complete server data deletion',
                type: ApplicationCommandOptionType.String,
                required: true,
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'set-community-fund',
        description: 'Create and set the Community Tip Fund wallet (Admin only - Auto-generated wallet)',
        options: [
            {
                name: 'fund-name',
                description: 'Name for the Community Fund (e.g., "Main Fund", "Gaming Fund")',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'supported-tokens',
                description: 'Comma-separated list of supported token tickers (e.g., EGLD,USDC,USDT)',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'qr-code-url',
                description: 'URL to the community fund wallet QR code image (optional)',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
    },


    {
        name: 'challenge-rps',
        description: 'Challenge another user to Rock, Paper, Scissors using your virtual balance',
        options: [
            {
                name: 'user-tag',
                description: 'The Discord username to challenge (without @ symbol)',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'token-ticker',
                description: 'The token to use for the challenge',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'amount',
                description: 'Amount to stake for the challenge',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'memo',
                description: 'Optional memo or reason for the challenge',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'list-rps-challenges',
        description: 'List active Rock, Paper, Scissors challenges',
        options: [
            {
                name: 'public',
                description: 'Whether to make the response visible to everyone',
                type: ApplicationCommandOptionType.Boolean,
                required: false,
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'debug-server-config',
        description: 'Debug server configuration for troubleshooting (Admin only)',
        options: [],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'debug-user',
        description: 'Debug information for a specific user (Admin only)',
        options: [
            {
                name: 'user-tag',
                description: 'The Discord user tag to debug',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'create-fixtures',
        description: 'Create football fixtures for today with betting (Admin only)',
        options: [
            {
                name: 'competition',
                description: 'Football competition code (e.g., PL, CL, ELC)',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'token',
                description: 'ESDT token to use for betting',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'amount',
                description: 'Required bet amount in whole token units',
                type: ApplicationCommandOptionType.Number,
                required: true,
                min_value: 0.1
            },
            {
                name: 'channel',
                description: 'Channel to post fixtures in (optional)',
                type: ApplicationCommandOptionType.Channel,
                required: false,
                channel_types: [0] // Text channels only
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'football-leaderboard-all',
        description: 'Show football betting leaderboard',
        options: [
            {
                name: 'public',
                description: 'Whether to make the response visible to everyone',
                type: ApplicationCommandOptionType.Boolean,
                required: false,
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'my-football-stats',
        description: 'View your personal football betting statistics and PNL',
        options: [
            {
                name: 'public',
                description: 'Show stats publicly (default: private)',
                type: ApplicationCommandOptionType.Boolean,
                required: false,
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'football-leaderboard-filtered',
        description: 'View leaderboard filtered by date range and competition',
        options: [
            {
                name: 'start-date',
                description: 'Start date in YYYY-MM-DD (US) or DD-MM-YYYY (EU) format',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'end-date',
                description: 'End date in YYYY-MM-DD (US) or DD-MM-YYYY (EU) format',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'competition',
                description: 'Competition code to filter by (e.g., PL, CL, ELC) (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
                autocomplete: true
            },
            {
                name: 'public',
                description: 'Show leaderboard publicly (default: private)',
                type: ApplicationCommandOptionType.Boolean,
                required: false,
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'update-token-metadata',
        description: 'Update token metadata for all supported tokens (Admin only)',
        options: [],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'get-competition',
        description: 'Show the last competition used for creating fixtures',
        options: [],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'test-football-api',
        description: 'Test football-data.org API connectivity (Admin only)',
        options: [],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'house-balance',
        description: 'View house balance from no-winner matches (Admin only)',
        options: [
            {
                name: 'public',
                description: 'Show balance publicly (default: private)',
                type: ApplicationCommandOptionType.Boolean,
                required: false,
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'house-tip',
        description: 'Tip user using house balance (from community fund, Admin only)',
        options: [
            {
                name: 'user',
                description: 'The user to tip',
                type: ApplicationCommandOptionType.User,
                required: true,
            },
            {
                name: 'house-type',
                description: 'Source of house balance to tip from',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    {
                        name: '⚽ Betting House Balance',
                        value: 'betting'
                    },
                    {
                        name: '🎨 Auction House Balance',
                        value: 'auction'
                    },
                    {
                        name: '🎲 Lottery House Balance',
                        value: 'lottery'
                    },
                    {
                        name: '🪂 Drop House Balance',
                        value: 'drop'
                    }
                ]
            },
            {
                name: 'token',
                description: 'Token to tip',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'amount',
                description: 'Amount to tip',
                type: ApplicationCommandOptionType.Number,
                required: true,
                min_value: 0
            },
            {
                name: 'memo',
                description: 'Optional reason for the tip',
                type: ApplicationCommandOptionType.String,
                required: false,
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'house-withdraw',
        description: 'Withdraw from house balance to project wallet (on-chain, Admin only)',
        options: [
            {
                name: 'source',
                description: 'Source of house balance to withdraw from',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    {
                        name: '⚽ Betting House Balance',
                        value: 'betting'
                    },
                    {
                        name: '🎨 Auction House Balance',
                        value: 'auction'
                    },
                    {
                        name: '🎲 Lottery House Balance',
                        value: 'lottery'
                    },
                    {
                        name: '🪂 Drop House Balance',
                        value: 'drop'
                    }
                ]
            },
            {
                name: 'project-name',
                description: 'Project wallet to withdraw to',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'token',
                description: 'Token to withdraw',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'amount',
                description: 'Amount to withdraw (enter a number or "MAX" for full balance)',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'memo',
                description: 'Optional reason for the withdrawal',
                type: ApplicationCommandOptionType.String,
                required: false,
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'check-balance-esdt',
        description: 'Check your virtual account balance for all supported tokens',
        options: [
            {
                name: 'public',
                description: 'Show balance publicly (default: private)',
                type: ApplicationCommandOptionType.Boolean,
                required: false
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'balance-history',
        description: 'View your recent transaction history',
        options: [
            {
                name: 'limit',
                description: 'Number of transactions to show (default: 10, max: 50)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                min_value: 1,
                max_value: 50
            },
            {
                name: 'public',
                description: 'Show history publicly (default: private)',
                type: ApplicationCommandOptionType.Boolean,
                required: false
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'check-balance-nft',
        description: 'Check your NFT virtual account balance',
        options: [
            {
                name: 'collection',
                description: 'Filter by collection (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
                autocomplete: true
            },
            {
                name: 'public',
                description: 'Show balance publicly (default: private)',
                type: ApplicationCommandOptionType.Boolean,
                required: false
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'balance-history-nft',
        description: 'View your NFT transaction history',
        options: [
            {
                name: 'collection',
                description: 'Filter by collection (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
                autocomplete: true
            },
            {
                name: 'limit',
                description: 'Number of transactions to show (default: 10, max: 50)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                min_value: 1,
                max_value: 50
            },
            {
                name: 'public',
                description: 'Show history publicly (default: private)',
                type: ApplicationCommandOptionType.Boolean,
                required: false
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'show-my-nft',
        description: 'View detailed information about an NFT in your Virtual Account',
        options: [
            {
                name: 'collection',
                description: 'NFT collection',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'nft-name',
                description: 'NFT name or identifier',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'public',
                description: 'Show NFT details publicly (default: private)',
                type: ApplicationCommandOptionType.Boolean,
                required: false
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'withdraw-nft',
        description: 'Withdraw an NFT or SFT from your Virtual Account to your registered wallet',
        options: [
            {
                name: 'collection',
                description: 'NFT/SFT collection',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'nft-name',
                description: 'NFT/SFT name or identifier',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'amount',
                description: 'Amount to withdraw (default: 1, required for SFTs)',
                type: ApplicationCommandOptionType.Number,
                required: false,
                min_value: 1
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'withdraw-nft-bulk',
        description: 'Withdraw multiple NFTs from your Virtual Account to your registered wallet (up to 50 NFTs)',
        options: [
            {
                name: 'collection',
                description: 'Filter by NFT/SFT collection (optional - leave empty to see all collections)',
                type: ApplicationCommandOptionType.String,
                required: false,
                autocomplete: true
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'sell-nft',
        description: 'List an NFT for sale on the marketplace',
        options: [
            {
                name: 'collection',
                description: 'NFT collection',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'nft-name',
                description: 'NFT name or identifier',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'title',
                description: 'Listing title',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'price-token',
                description: 'Token for payment',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'price-amount',
                description: 'Fixed price amount',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'listing-type',
                description: 'Listing type',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Fixed Price', value: 'fixed_price' },
                    { name: 'Accept Offers', value: 'accept_offers' }
                ]
            },
            {
                name: 'description',
                description: 'Listing description',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'expires-in',
                description: 'Hours until expiration (optional)',
                type: ApplicationCommandOptionType.Number,
                required: false,
                min_value: 1
            },
            {
                name: 'amount',
                description: 'Amount to list (default: 1, required for SFTs)',
                type: ApplicationCommandOptionType.Number,
                required: false,
                min_value: 1
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'blockchain-status',
        description: 'Check blockchain listener status (Admin only)',
        options: [],
        default_member_permissions: null,
    },
    {
        name: 'server-balances',
        description: 'View server-wide virtual account summary (Admin only)',
        options: [
            {
                name: 'public',
                description: 'Show summary publicly (default: private)',
                type: ApplicationCommandOptionType.Boolean,
                required: false
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'update-usernames',
        description: 'Update Discord usernames for all virtual accounts (Admin only)',
        options: [],
        default_member_permissions: null,
    },
    {
        name: 'check-community-fund-balance',
        description: 'Check Community Fund balances. Calculates mass withdraw costs (Admin only)',
        options: [
            {
                name: 'transfers',
                description: 'Number of transfers to check (default: 1). Also shows analysis for all mass withdraw transactions.',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                min_value: 1
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'tip-virtual-esdt',
        description: 'Tip another user using your virtual account ESDT balance',
        options: [
            {
                name: 'user-tag',
                description: 'User to tip (use @mention or username)',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'token-ticker',
                description: 'Token to tip (e.g., REWARD)',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'amount',
                description: 'Amount to tip',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'memo',
                description: 'Optional memo for the tip',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'tip-virtual-nft',
        description: 'Tip another user an NFT from your virtual account',
        options: [
            {
                name: 'user-tag',
                description: 'User to tip (use @mention or username)',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'collection',
                description: 'NFT collection',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'nft-name',
                description: 'NFT name or identifier',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'memo',
                description: 'Optional memo for the tip',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'amount',
                description: 'Amount to tip (default: 1, required for SFTs)',
                type: ApplicationCommandOptionType.Number,
                required: false,
                min_value: 1
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'virtual-house-topup',
        description: 'Transfer funds from your Virtual Account to House Balance',
        options: [
            {
                name: 'token',
                description: 'Token identifier (Community Fund supported tokens)',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'amount',
                description: 'Amount to transfer to house',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'house-type',
                description: 'Which house type to allocate funds to',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    {
                        name: '⚽ Betting House Balance',
                        value: 'betting'
                    },
                    {
                        name: '🎨 Auction House Balance',
                        value: 'auction'
                    },
                    {
                        name: '🎲 Lottery House Balance',
                        value: 'lottery'
                    },
                    {
                        name: '🪂 Drop House Balance',
                        value: 'drop'
                    }
                ]
            },
            {
                name: 'memo',
                description: 'Optional memo/note for this transaction',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'withdraw-esdt',
        description: 'Withdraw funds from your virtual account to your wallet',
        options: [
            {
                name: 'token-ticker',
                description: 'Token to withdraw (shows only tokens you have)',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'amount',
                description: 'Amount to withdraw (use "MAX" or "ALL" for full balance)',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'memo',
                description: 'Optional memo for the withdrawal',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'help',
        description: 'Display all available bot commands organized by category',
        options: [],
        default_member_permissions: null,
    },
    {
        name: 'create-lottery',
        description: 'Create a new lottery game (Admin only)',
        options: [
            {
                name: 'winning_numbers_count',
                description: 'Number of numbers users need to pick (1-10)',
                type: ApplicationCommandOptionType.Integer,
                required: true,
                min_value: 1,
                max_value: 10
            },
            {
                name: 'total_pool_numbers',
                description: 'Total numbers in the pool (5-100)',
                type: ApplicationCommandOptionType.Integer,
                required: true,
                min_value: 5,
                max_value: 100
            },
            {
                name: 'token',
                description: 'Token to use for tickets and prizes',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'drawing_frequency',
                description: 'How often to draw winners',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: '1 Hour', value: '1h' },
                    { name: '1 Day', value: '1d' },
                    { name: '1 Week', value: '1W' },
                    { name: '1 Month', value: '1M' }
                ]
            },
            {
                name: 'ticket_price',
                description: 'Price per ticket',
                type: ApplicationCommandOptionType.Number,
                required: true,
                min_value: 0.00000001
            },
            {
                name: 'house_commission',
                description: 'House commission percentage (0-50)',
                type: ApplicationCommandOptionType.Number,
                required: false,
                min_value: 0,
                max_value: 50
            },
            {
                name: 'use_house_lottery_balance',
                description: 'Use House Lottery balance to fund initial prize pool',
                type: ApplicationCommandOptionType.Boolean,
                required: false
            },
            {
                name: 'initial_prize_pool',
                description: 'Initial prize pool (only if use_house_lottery_balance). Defaults to full balance.',
                type: ApplicationCommandOptionType.Number,
                required: false,
                min_value: 0.00000001
            }
        ],
        default_member_permissions: null, // Permissions checked in code
    },
    {
        name: 'my-active-lottery-tickets',
        description: 'View your active lottery tickets',
        options: [
            {
                name: 'token',
                description: 'Filter by token (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
                autocomplete: true
            },
            {
                name: 'page',
                description: 'Page number (default: 1)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                min_value: 1
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'my-expired-tickets',
        description: 'View your expired lottery tickets with results',
        options: [
            {
                name: 'token',
                description: 'Filter by token (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
                autocomplete: true
            },
            {
                name: 'page',
                description: 'Page number (default: 1)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                min_value: 1
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'my-lottery-stats',
        description: 'View your lottery statistics across all tokens',
        options: [],
        default_member_permissions: null,
    },
    {
        name: 'update-lottery',
        description: 'Update an existing lottery (Admin only)',
        options: [
            {
                name: 'lottery_id',
                description: 'Select the lottery to update',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'topup_prize_pool',
                description: 'Amount to add to prize pool from house lottery balance',
                type: ApplicationCommandOptionType.Number,
                required: false,
                min_value: 0.00000001
            },
            {
                name: 'update_ticket_price',
                description: 'New ticket price',
                type: ApplicationCommandOptionType.Number,
                required: false,
                min_value: 0.00000001
            }
        ],
        default_member_permissions: null, // Permissions checked in code
    },
    {
        name: 'update-football-match',
        description: 'Top up the bonus pot (prize pool) for an existing football match (Admin only)',
        options: [
            {
                name: 'game_id',
                description: 'Select the match to update',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'topup-pot-size',
                description: 'Amount to add to the bonus pot (prize pool)',
                type: ApplicationCommandOptionType.Number,
                required: true,
                min_value: 0.1
            }
        ],
        default_member_permissions: null, // Permissions checked in code
    },
    {
        name: 'create-staking-pool',
        description: 'Create a new NFT staking pool',
        options: [
            {
                name: 'collection_ticker',
                description: 'Collection ticker for the staking pool',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'reward_token_identifier',
                description: 'Token identifier for staking rewards',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'initial_supply',
                description: 'Initial reward supply amount',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'reward_per_nft_per_day',
                description: 'Daily reward amount per NFT',
                type: ApplicationCommandOptionType.String,
                required: true
            },
            {
                name: 'duration_months',
                description: 'Pool duration in months (1-12, required)',
                type: ApplicationCommandOptionType.Integer,
                required: true,
                choices: [
                    { name: '1 month', value: 1 },
                    { name: '2 months', value: 2 },
                    { name: '3 months', value: 3 },
                    { name: '4 months', value: 4 },
                    { name: '5 months', value: 5 },
                    { name: '6 months', value: 6 },
                    { name: '7 months', value: 7 },
                    { name: '8 months', value: 8 },
                    { name: '9 months', value: 9 },
                    { name: '10 months', value: 10 },
                    { name: '11 months', value: 11 },
                    { name: '12 months', value: 12 }
                ]
            },
            {
                name: 'pool_name',
                description: 'Display name for the pool (defaults to collection name)',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'staking_total_limit',
                description: 'Maximum NFTs that can be staked in the pool',
                type: ApplicationCommandOptionType.Integer,
                required: false
            },
            {
                name: 'staking_limit_per_user',
                description: 'Maximum NFTs a user can stake',
                type: ApplicationCommandOptionType.Integer,
                required: false
            }
        ],
        default_member_permissions: null
    },
    {
        name: 'update-staking-pool',
        description: 'Update an existing staking pool',
        options: [
            {
                name: 'staking_pool',
                description: 'Select the staking pool to update',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'topup_staking_pool',
                description: 'Add more tokens to the pool supply',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'change_reward_per_nft',
                description: 'Update the daily reward per NFT',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'increase_nft_pool_limit',
                description: 'Increase the total NFT limit (must be higher than current)',
                type: ApplicationCommandOptionType.Integer,
                required: false
            },
            {
                name: 'increase_user_staking_limit',
                description: 'Increase the per-user staking limit (must be higher than current)',
                type: ApplicationCommandOptionType.Integer,
                required: false
            },
            {
                name: 'trait_filter_action',
                description: 'Action to perform on trait filters',
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: [
                    { name: 'Add filter', value: 'add' },
                    { name: 'Remove filter by index', value: 'remove' },
                    { name: 'Clear all filters', value: 'clear' }
                ]
            },
            {
                name: 'trait_filter_type',
                description: 'Trait type to filter (required if action is add)',
                type: ApplicationCommandOptionType.String,
                required: false,
                autocomplete: true
            },
            {
                name: 'trait_filter_value',
                description: 'Specific trait value (optional, leave empty for any value)',
                type: ApplicationCommandOptionType.String,
                required: false,
                autocomplete: true
            },
            {
                name: 'trait_filter_index',
                description: 'Select filter to remove (required if action is remove)',
                type: ApplicationCommandOptionType.String,
                required: false,
                autocomplete: true
            }
        ],
        default_member_permissions: null
    },
    {
        name: 'close-staking-pool',
        description: 'Close a staking pool and return NFTs to users',
        options: [
            {
                name: 'staking_pool_name',
                description: 'Select the staking pool to close',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            }
        ],
        default_member_permissions: null
    },
    {
        name: 'start-drop-game-automation',
        description: 'Start automated DROP game with hourly rounds',
        options: [
            {
                name: 'token-ticker',
                description: 'Token identifier for airdrop rewards (e.g., REWARD-cf6eac)',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'base-amount',
                description: 'Base reward amount per point',
                type: ApplicationCommandOptionType.Number,
                required: true
            },
            {
                name: 'min-droppers',
                description: 'Minimum number of participants required to close a round',
                type: ApplicationCommandOptionType.Integer,
                required: true
            },
            {
                name: 'collection-identifier',
                description: 'NFT collection identifier for supporter status (optional)',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'nft-collection-multiplier',
                description: 'Enable NFT collection multiplier for supporter status',
                type: ApplicationCommandOptionType.Boolean,
                required: false
            }
        ],
        default_member_permissions: '0'
    },
    {
        name: 'stop-drop-game-automation',
        description: 'Stop automated DROP game',
        options: [],
        default_member_permissions: '0'
    },
    {
        name: 'drop-leaderboard',
        description: 'Show DROP game weekly leaderboard',
        options: [
            {
                name: 'week',
                description: 'Show specific week (leave empty for current week)',
                type: ApplicationCommandOptionType.String,
                required: false
            }
        ],
        default_member_permissions: null
    },
];

// Export commands for use in other scripts
module.exports = { commands };

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

// Add timeout wrapper
function withTimeout(promise, timeoutMs, errorMessage) {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        )
    ]);
}

// Retry function with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            
            const delay = initialDelay * Math.pow(2, attempt - 1);
            console.log(`⚠️  Attempt ${attempt} failed. Retrying in ${delay / 1000} seconds...`);
            console.log(`   Error: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Only run global registration if this file is executed directly (not imported)
if (require.main === module) {
    (async () => {
    try {
        console.log(`\n📊 Registering ${commands.length} commands...`);
        console.log(`⏱️  This may take up to 30 seconds due to Discord rate limits.\n`);
        
        // Ask user if they want to delete existing commands first
        // Skip deletion by default to avoid losing commands if registration fails
        const SKIP_DELETE = process.env.SKIP_DELETE !== 'false'; // Default to true (skip delete)
        
        if (!SKIP_DELETE) {
            // Delete all global commands first
            console.log('🗑️  Step 1: Deleting all global slash commands...');
            try {
                await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
                console.log('✅ All global commands deleted.\n');
            } catch (deleteError) {
                console.error('❌ Error deleting commands:', deleteError.message);
                if (deleteError.message.includes('429')) {
                    console.error('⚠️  Rate limited! Please wait 5-10 minutes and try again.');
                    process.exit(1);
                }
                // Continue anyway - commands might already be deleted
            }

            // Wait a few seconds to ensure deletion is processed
            console.log('⏳ Waiting 10 seconds for Discord to process deletion...');
            await new Promise(resolve => setTimeout(resolve, 10000));
        } else {
            console.log('💡 Skipping deletion step (commands will be updated/merged)');
            console.log('   Set SKIP_DELETE=false in .env to delete first\n');
        }

        // Register new global commands with retry logic
        console.log('📝 Step 2: Registering new global slash commands...');
        console.log(`📦 Total commands: ${commands.length}`);
        console.log('⏳ This may take 2-3 minutes if Discord API is slow...\n');
        
        // Validate commands structure first
        console.log('🔍 Validating command structure...');
        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];
            if (!cmd.name || !cmd.description) {
                console.error(`❌ Command ${i + 1} is missing name or description:`, cmd);
                process.exit(1);
            }
            if (cmd.name.length > 32) {
                console.error(`❌ Command ${i + 1} name too long (max 32): ${cmd.name}`);
                process.exit(1);
            }
            if (cmd.description.length > 100) {
                console.error(`❌ Command ${i + 1} description too long (max 100): ${cmd.description}`);
                process.exit(1);
            }
        }
        console.log('✅ Command structure validation passed.\n');
        
        // Test network connectivity first
        console.log('🌐 Testing network connectivity to Discord API...');
        try {
            const testUrl = 'https://discord.com/api/v10';
            const testResponse = await fetch(testUrl, { 
                method: 'HEAD',
                signal: AbortSignal.timeout(5000)
            });
            console.log('✅ Network connectivity OK\n');
        } catch (networkError) {
            console.error('❌ Network connectivity test failed!');
            console.error('Error:', networkError.message);
            console.error('\n💡 Troubleshooting steps:');
            console.error('   1. Check your internet connection');
            console.error('   2. Check if Discord API is accessible: https://discord.com/api/v10');
            console.error('   3. Check firewall/proxy settings');
            console.error('   4. Try using a VPN if Discord is blocked in your region');
            console.error('   5. Wait a few minutes and try again (Discord might be experiencing issues)\n');
            throw new Error('Network connectivity test failed. Cannot proceed with registration.');
        }

        const startTime = Date.now();
        const registeredCommands = await retryWithBackoff(async () => {
            try {
                // Add timeout to the request
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
                
                try {
                    const result = await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { 
                        body: commands,
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);
                    return result;
                } catch (fetchError) {
                    clearTimeout(timeoutId);
                    throw fetchError;
                }
            } catch (error) {
                // Log the actual Discord error response
                console.error('\n📋 Discord API Error Details:');
                console.error('Status:', error.status || error.statusCode || 'Unknown');
                console.error('Message:', error.message);
                
                // Handle DNS/network errors specifically
                if (error.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
                    console.error('\n⚠️  DNS/Network Error Detected!');
                    console.error('   This is a network connectivity issue, not a code problem.');
                    console.error('   Possible causes:');
                    console.error('   - DNS resolution failure');
                    console.error('   - Firewall/proxy blocking Discord API');
                    console.error('   - Discord API temporarily unavailable');
                    console.error('   - Network connectivity issues');
                    console.error('\n💡 Solutions:');
                    console.error('   1. Check your internet connection');
                    console.error('   2. Try again in a few minutes');
                    console.error('   3. Check firewall/antivirus settings');
                    console.error('   4. Try using guild commands instead (they work!)');
                    console.error('   5. Use a VPN if Discord is blocked in your region');
                }
                
                if (error.requestBody) {
                    console.error('Request Body Size:', JSON.stringify(error.requestBody).length, 'bytes');
                }
                if (error.rawError) {
                    console.error('Raw Error:', JSON.stringify(error.rawError, null, 2));
                }
                if (error.code) {
                    console.error('Error Code:', error.code);
                }
                if (error.status === 400) {
                    console.error('\n⚠️  BAD REQUEST (400) - One or more commands have invalid structure!');
                    console.error('Check the command structure above for issues.');
                }
                throw error;
            }
        }, 3, 10000); // 3 retries, starting with 10 second delay
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ Global slash commands were registered successfully! (took ${duration}s)\n`);
        
        console.log('📋 Commands registered:');
        if (Array.isArray(registeredCommands)) {
            registeredCommands.forEach((cmd, index) => {
                console.log(`   ${index + 1}. /${cmd.name}: ${cmd.description}`);
            });
        } else {
            commands.forEach((cmd, index) => {
                console.log(`   ${index + 1}. /${cmd.name}: ${cmd.description}`);
            });
        }
        
        console.log(`\n✨ Registration complete! ${commands.length} commands are now available.\n`);
        
    } catch (error) {
        console.error('\n❌ Registration failed!\n');
        console.error('Error:', error.message);
        
        // Log full error details
        if (error.status) {
            console.error('HTTP Status:', error.status);
        }
        if (error.code) {
            console.error('Error Code:', error.code);
        }
        if (error.rawError) {
            console.error('Discord Error Response:', JSON.stringify(error.rawError, null, 2));
        }
        
        if (error.status === 400) {
            console.error('\n⚠️  BAD REQUEST (400) - Invalid command structure!');
            console.error('One or more commands have invalid options or structure.');
            console.error('Common issues:');
            console.error('  - Option name/description too long');
            console.error('  - Invalid option type');
            console.error('  - Missing required fields');
            console.error('  - Command name/description too long');
            console.error('\n💡 TIP: Try registering commands in smaller batches to identify the problematic command.\n');
        } else if (error.message.includes('429') || error.status === 429) {
            console.error('\n⚠️  RATE LIMIT EXCEEDED!');
            console.error('Discord allows 200 command updates per day per application.');
            console.error('Per-endpoint limit: 5 requests per 5 seconds');
            console.error('\n⏰ WAIT TIME RECOMMENDATIONS:');
            console.error('   - For 429 errors: Wait 10-15 minutes');
            console.error('   - For timeout errors: Wait 5-10 minutes');
            console.error('   - If you hit daily limit (200/day): Wait 24 hours\n');
        } else if (error.message.includes('401') || error.status === 401) {
            console.error('\n⚠️  AUTHENTICATION ERROR!');
            console.error('Please check your TOKEN and CLIENT_ID in .env file.\n');
        } else if (error.message.includes('timeout')) {
            console.error('\n⚠️  TIMEOUT ERROR!');
            console.error('Discord API is slow or rate limiting.');
            console.error('\n⏰ WAIT TIME RECOMMENDATIONS:');
            console.error('   - Wait 15-20 minutes before trying again');
            console.error('   - The API may be experiencing high load');
            console.error('   - Try again during off-peak hours (late night/early morning UTC)\n');
            console.error('💡 TIP: The script will now retry automatically with exponential backoff.');
            console.error('   If it still fails after 3 attempts, wait 20-30 minutes.\n');
        } else {
            console.error('\nError details:', error.stack);
        }
        
        process.exit(1);
    }
    })();
} 