require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

// Add debug logging
console.log('Environment variables check:');
console.log('TOKEN:', process.env.TOKEN ? 'Found' : 'Missing');
console.log('CLIENT_ID:', process.env.CLIENT_ID);

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
        name: 'list-wallets',
        description: 'List registered wallets by username (Admin only)',
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
        description: 'Register a new MultiversX project for token transfers (Admin only)',
        options: [
            {
                name: 'project-name',
                description: 'Name of the project',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'wallet-address',
                description: 'Wallet address for the project (erd1...)',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'wallet-pem',
                description: 'PEM file content for the project wallet',
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
                name: 'qr-code-url',
                description: 'QR code image URL for the wallet address (optional)',
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
                name: 'qr-code-url',
                description: 'QR code image URL for the wallet address (optional)',
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
        name: 'set-community-fund',
        description: 'Set the project to be used as the Community Tip Fund (Admin only)',
        options: [
            {
                name: 'project-name',
                description: 'The project to use as the Community Tip Fund',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'qr-code-url',
                description: 'URL to the community fund wallet QR code image (optional)',
                type: ApplicationCommandOptionType.String,
                required: false
            },
            {
                name: 'confirm',
                description: 'Type CONFIRM to overwrite the current Community Tip Fund',
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
        name: 'join-rps',
        description: 'Join a Rock, Paper, Scissors challenge using your virtual balance',
        options: [
            {
                name: 'challenge-id',
                description: 'The challenge ID to join',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
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
        name: 'play-rps',
        description: 'Play your move in an active Rock, Paper, Scissors challenge',
        options: [
            {
                name: 'challenge-id',
                type: 3,
                description: 'The ID of the RPS challenge',
                required: true,
                autocomplete: true
            },
            {
                name: 'move',
                type: 3,
                description: 'Your move (rock, paper, or scissors)',
                required: true,
                choices: [
                    { name: 'Rock', value: 'rock' },
                    { name: 'Paper', value: 'paper' },
                    { name: 'Scissors', value: 'scissors' }
                ]
            }
        ]
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
                name: 'user-id',
                description: 'The Discord user ID to debug',
                type: ApplicationCommandOptionType.String,
                required: true,
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
        name: 'current-bets',
        description: 'Show current active football bets for today',
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
        name: 'leaderboard',
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
        name: 'my-stats',
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
        name: 'leaderboard-filtered',
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
        name: 'leaderboard-reset',
        description: 'Reset football betting leaderboard (Admin only)',
        options: [
            {
                name: 'confirm',
                description: 'Type "RESET" to confirm leaderboard reset',
                type: ApplicationCommandOptionType.String,
                required: true,
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
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
        name: 'check-balance',
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
                required: false
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
        name: 'tip-virtual',
        description: 'Tip another user using your virtual account balance',
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
        name: 'withdraw',
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
        name: 'bet-virtual',
        description: 'Place a bet on a football match using your virtual balance',
        options: [
            {
                name: 'match-id',
                description: 'ID of the match to bet on',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'outcome',
                description: 'Betting outcome (H for Home, A for Away, D for Draw)',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: 'Home Win', value: 'H' },
                    { name: 'Away Win', value: 'A' },
                    { name: 'Draw', value: 'D' }
                ]
            }
        ],
        default_member_permissions: null,
    },
    {
        name: 'force-close-games',
        description: 'Force close stuck football games that have scores but are still scheduled (Admin only)',
        options: [],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'help',
        description: 'Display all available bot commands organized by category',
        options: [],
        default_member_permissions: null,
    },
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        // Delete all global commands first
        console.log('Deleting all global slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: [] }
        );
        console.log('All global commands deleted.');

        // Wait a few seconds to ensure deletion is processed
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Register new global commands
        console.log('Registering new global slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('Global slash commands were registered successfully!');
        
        console.log('Commands registered:');
        commands.forEach(cmd => {
            console.log(`- /${cmd.name}: ${cmd.description}`);
        });
        
    } catch (error) {
        console.log(`There was an error: ${error}`);
        console.log('Error details:', error.stack);
    }
})(); 