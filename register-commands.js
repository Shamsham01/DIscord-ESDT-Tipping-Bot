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
                name: 'wallet-pem',
                description: 'PEM file content for the project wallet',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'supported-tokens',
                description: 'Comma-separated list of supported token tickers',
                type: ApplicationCommandOptionType.String,
                required: true,
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
                name: 'wallet-pem',
                description: 'New PEM file content for the project wallet (optional)',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
            {
                name: 'supported-tokens',
                description: 'New comma-separated list of supported token tickers (optional)',
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
            }
        ],
        default_member_permissions: null, // Permissions are checked in code
    },
    {
        name: 'tip',
        description: 'Tip another user using the Community Tip Fund',
        options: [
            {
                name: 'user-tag',
                description: 'The Discord username to tip (without @ symbol)',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'token-ticker',
                description: 'The token ticker to use for this tip',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true
            },
            {
                name: 'amount',
                description: 'The amount of tokens to tip',
                type: ApplicationCommandOptionType.Number,
                required: true,
                min_value: 0
            },
            {
                name: 'memo',
                description: 'Optional memo or reason for the tip',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
        ],
        default_member_permissions: null, // Permissions are checked in code
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
