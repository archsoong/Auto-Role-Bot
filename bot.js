const { Client, GatewayIntentBits, Collection } = require('discord.js');

// Bot configuration
const config = {
    token: process.env.TOKEN || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN, // Try multiple env var names
    inviteRoleMap: {
        // Map invite codes to role IDs
        'DmFzg8Pdk3': '1394618100879589396' //Example: 'abc123def': '123456789012345678'
    }
};

// Add token validation
if (!config.token || config.token === 'YOUR_BOT_TOKEN') {
    console.error('❌ ERROR: No valid Discord token provided!');
    console.error('Please set the DISCORD_TOKEN environment variable in Zeabur.');
    console.error('Available environment variables:', Object.keys(process.env).filter(key => key.includes('TOKEN')));
    process.exit(1);
}

// Create bot client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites
    ]
});

// Store invite data
const invites = new Collection();

// Bot ready event
client.once('ready', async () => {
    console.log(`✅ Bot is ready! Logged in as ${client.user.tag}`);
    console.log(`🏠 Bot is in ${client.guilds.cache.size} server(s)`);
    console.log(`🔗 Invite mappings configured: ${Object.keys(config.inviteRoleMap).length}`);
    
    // Cache all invites for all guilds
    for (const guild of client.guilds.cache.values()) {
        try {
            const guildInvites = await guild.invites.fetch();
            invites.set(guild.id, new Collection(guildInvites.map(invite => [invite.code, invite.uses])));
            console.log(`📋 Cached ${guildInvites.size} invites for guild: ${guild.name}`);
        } catch (error) {
            console.error(`❌ Error caching invites for guild ${guild.name}:`, error);
        }
    }
});

// Handle new guild joins
client.on('guildCreate', async (guild) => {
    try {
        const guildInvites = await guild.invites.fetch();
        invites.set(guild.id, new Collection(guildInvites.map(invite => [invite.code, invite.uses])));
        console.log(`Cached invites for new guild: ${guild.name}`);
    } catch (error) {
        console.error(`Error caching invites for new guild ${guild.name}:`, error);
    }
});

// Handle invite creation
client.on('inviteCreate', (invite) => {
    const guildInvites = invites.get(invite.guild.id);
    if (guildInvites) {
        guildInvites.set(invite.code, invite.uses);
    }
});

// Handle invite deletion
client.on('inviteDelete', (invite) => {
    const guildInvites = invites.get(invite.guild.id);
    if (guildInvites) {
        guildInvites.delete(invite.code);
    }
});

// Handle member join
client.on('guildMemberAdd', async (member) => {
    try {
        const guild = member.guild;
        const cachedInvites = invites.get(guild.id);
        
        if (!cachedInvites) {
            console.log(`No cached invites for guild: ${guild.name}`);
            return;
        }

        // Fetch current invites
        const currentInvites = await guild.invites.fetch();
        
        // Find which invite was used
        let usedInvite = null;
        
        for (const [code, uses] of currentInvites) {
            const cachedUses = cachedInvites.get(code) || 0;
            if (uses > cachedUses) {
                usedInvite = { code, uses };
                break;
            }
        }
        
        // Update cache
        for (const [code, uses] of currentInvites) {
            cachedInvites.set(code, uses);
        }
        
        if (!usedInvite) {
            console.log(`Could not determine which invite was used for ${member.user.tag}`);
            return;
        }
        
        console.log(`${member.user.tag} joined using invite: ${usedInvite.code}`);
        
        // Check if this invite has a role mapping
        const roleId = config.inviteRoleMap[usedInvite.code];
        
        if (roleId) {
            const role = guild.roles.cache.get(roleId);
            
            if (role) {
                try {
                    await member.roles.add(role);
                    console.log(`✅ Added role "${role.name}" to ${member.user.tag} (joined via ${usedInvite.code})`);
                } catch (error) {
                    console.error(`❌ Error adding role to ${member.user.tag}:`, error);
                }
            } else {
                console.log(`❌ Role with ID ${roleId} not found for invite ${usedInvite.code}`);
            }
        } else {
            console.log(`No role mapping configured for invite: ${usedInvite.code}`);
        }
        
    } catch (error) {
        console.error('Error in guildMemberAdd event:', error);
    }
});

// Handle errors
client.on('error', (error) => {
    console.error('Discord client error:', error);
});

// Utility function to get invite code from full URL
function getInviteCodeFromUrl(url) {
    const match = url.match(/discord\.gg\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
}

// Command to add new invite-role mapping (optional)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // Simple command system (you can expand this)
    if (message.content.startsWith('!addmapping')) {
        // Check if user has admin permissions
        if (!message.member.permissions.has('ADMINISTRATOR')) {
            return message.reply('You need administrator permissions to use this command.');
        }
        
        const args = message.content.split(' ');
        if (args.length !== 3) {
            return message.reply('Usage: !addmapping <invite_code> <role_id>');
        }
        
        const inviteCode = args[1];
        const roleId = args[2];
        
        // Validate role exists
        const role = message.guild.roles.cache.get(roleId);
        if (!role) {
            return message.reply(`Role with ID ${roleId} not found.`);
        }
        
        // Add to config (this is temporary - you'd want to save to a database)
        config.inviteRoleMap[inviteCode] = roleId;
        
        message.reply(`✅ Added mapping: Invite \`${inviteCode}\` → Role \`${role.name}\``);
    }
    
    if (message.content.startsWith('!listmappings')) {
        if (!message.member.permissions.has('ADMINISTRATOR')) {
            return message.reply('You need administrator permissions to use this command.');
        }
        
        const mappings = Object.entries(config.inviteRoleMap);
        if (mappings.length === 0) {
            return message.reply('No invite-role mappings configured.');
        }
        
        let response = '**Current Invite-Role Mappings:**\n';
        for (const [inviteCode, roleId] of mappings) {
            const role = message.guild.roles.cache.get(roleId);
            const roleName = role ? role.name : 'Unknown Role';
            response += `\`${inviteCode}\` → \`${roleName}\`\n`;
        }
        
        message.reply(response);
    }
});

// Login to Discord
client.login(config.token);

// Export for module use
module.exports = { client, config };