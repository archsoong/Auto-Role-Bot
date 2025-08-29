// Load environment variables from .env file (for local development)
require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');

// Bot configuration
const config = {
    token: process.env.TOKEN || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN, // Try multiple env var names
    inviteRoleMap: {
        // Map invite codes to role IDs
        'DmFzg8Pdk3': '1394618100879589396', //Example: 'abc123def': '123456789012345678'
        'TW8zH8rSp3': '1410812878180716584'
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
            
            // Log vanity URL if available
            if (guild.vanityURLCode) {
                console.log(`🔗 Guild ${guild.name} has vanity URL: discord.gg/${guild.vanityURLCode}`);
            }
            
            // Log some invite details for debugging
            if (guildInvites.size > 0) {
                console.log(`   Invite codes: ${Array.from(guildInvites.keys()).join(', ')}`);
            }
            
        } catch (error) {
            console.error(`❌ Error caching invites for guild ${guild.name}:`, error);
            console.error(`   This might be due to missing "Manage Server" or "Create Instant Invite" permissions`);
        }
    }
    
    console.log(`🎯 Bot initialization complete! Ready to track invite usage.`);
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
        
        console.log(`🔍 Member ${member.user.tag} joined guild: ${guild.name}`);
        
        if (!cachedInvites) {
            console.log(`❌ No cached invites for guild: ${guild.name}`);
            return;
        }

        // Fetch current invites
        const currentInvites = await guild.invites.fetch();
        
        console.log(`📊 Cached invites: ${cachedInvites.size}, Current invites: ${currentInvites.size}`);
        
        // Find which invite was used
        let usedInvite = null;
        
        // Debug: Log all invite usage comparisons
        console.log(`🔍 Checking invite usage for ${member.user.tag}:`);
        
        for (const [code, invite] of currentInvites) {
            const currentUses = invite.uses;
            const cachedUses = cachedInvites.get(code) || 0;
            console.log(`  - Invite ${code}: cached=${cachedUses}, current=${currentUses}`);
            
            if (currentUses > cachedUses) {
                usedInvite = { code, uses: currentUses, previousUses: cachedUses };
                console.log(`✅ Found used invite: ${code} (${cachedUses} → ${currentUses})`);
                break;
            }
        }
        
        // Check for new invites that weren't cached
        if (!usedInvite) {
            console.log(`🔍 Checking for new invites not in cache...`);
            for (const [code, invite] of currentInvites) {
                const currentUses = invite.uses;
                if (!cachedInvites.has(code) && currentUses > 0) {
                    usedInvite = { code, uses: currentUses, previousUses: 0 };
                    console.log(`✅ Found new invite used: ${code} (uses: ${currentUses})`);
                    break;
                }
            }
        }
        
        // Update cache with current invite data
        for (const [code, invite] of currentInvites) {
            cachedInvites.set(code, invite.uses);
        }
        
        // Handle case when no invite is found
        if (!usedInvite) {
            console.log(`❌ Could not determine which invite was used for ${member.user.tag}`);
            
            // Additional debugging information
            console.log(`📋 Debug info:`);
            console.log(`  - Guild has vanity URL: ${guild.vanityURLCode ? `discord.gg/${guild.vanityURLCode}` : 'No'}`);
            console.log(`  - Guild member count: ${guild.memberCount}`);
            console.log(`  - Available invites: ${Array.from(currentInvites.keys()).join(', ') || 'None'}`);
            
            // Check if guild has vanity URL (common cause of this issue)
            if (guild.vanityURLCode) {
                console.log(`💡 Member likely joined via vanity URL: discord.gg/${guild.vanityURLCode}`);
                
                // Check if vanity URL has a role mapping
                const roleId = config.inviteRoleMap[guild.vanityURLCode];
                if (roleId) {
                    const role = guild.roles.cache.get(roleId);
                    if (role) {
                        try {
                            await member.roles.add(role);
                            console.log(`✅ Added role "${role.name}" to ${member.user.tag} (vanity URL: ${guild.vanityURLCode})`);
                        } catch (error) {
                            console.error(`❌ Error adding role via vanity URL:`, error);
                        }
                    } else {
                        console.log(`❌ Role with ID ${roleId} not found for vanity URL ${guild.vanityURLCode}`);
                    }
                } else {
                    console.log(`📝 No role mapping configured for vanity URL: ${guild.vanityURLCode}`);
                    console.log(`💡 Add mapping with: !addmapping ${guild.vanityURLCode} <role_id>`);
                }
            }
            
            return;
        }
        
        console.log(`✅ ${member.user.tag} joined using invite: ${usedInvite.code}`);
        
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
            console.log(`📝 No role mapping configured for invite: ${usedInvite.code}`);
            console.log(`💡 Add mapping with: !addmapping ${usedInvite.code} <role_id>`);
        }
        
    } catch (error) {
        console.error('❌ Error in guildMemberAdd event:', error);
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
    
    // Add manual cache refresh command for troubleshooting
    if (message.content.startsWith('!refreshcache')) {
        if (!message.member.permissions.has('ADMINISTRATOR')) {
            return message.reply('You need administrator permissions to use this command.');
        }
        
        try {
            const guild = message.guild;
            const guildInvites = await guild.invites.fetch();
            invites.set(guild.id, new Collection(guildInvites.map(invite => [invite.code, invite.uses])));
            
            let response = `✅ **Invite cache refreshed for ${guild.name}**\n`;
            response += `📊 Cached ${guildInvites.size} invites\n`;
            
            if (guild.vanityURLCode) {
                response += `🔗 Vanity URL: discord.gg/${guild.vanityURLCode}\n`;
            }
            
            if (guildInvites.size > 0) {
                response += `📋 **Current invites:**\n`;
                for (const [code, invite] of guildInvites) {
                    response += `  \`${code}\` - ${invite.uses} uses\n`;
                }
            }
            
            message.reply(response);
            console.log(`🔄 Manual cache refresh performed for ${guild.name} by ${message.author.tag}`);
            
        } catch (error) {
            console.error(`❌ Error refreshing cache:`, error);
            message.reply('❌ Error refreshing invite cache. Check bot permissions.');
        }
    }
    
    // Add debug command to show current invite status
    if (message.content.startsWith('!invitedebug')) {
        if (!message.member.permissions.has('ADMINISTRATOR')) {
            return message.reply('You need administrator permissions to use this command.');
        }
        
        try {
            const guild = message.guild;
            const cachedInvites = invites.get(guild.id);
            const currentInvites = await guild.invites.fetch();
            
            let response = `🔍 **Invite Debug Info for ${guild.name}**\n\n`;
            
            // Basic info
            response += `📊 **Cache Status:**\n`;
            response += `  - Cached invites: ${cachedInvites ? cachedInvites.size : 0}\n`;
            response += `  - Current invites: ${currentInvites.size}\n`;
            response += `  - Guild member count: ${guild.memberCount}\n\n`;
            
            // Vanity URL info
            if (guild.vanityURLCode) {
                response += `🔗 **Vanity URL:** discord.gg/${guild.vanityURLCode}\n`;
                const vanityRoleId = config.inviteRoleMap[guild.vanityURLCode];
                if (vanityRoleId) {
                    const role = guild.roles.cache.get(vanityRoleId);
                    response += `  - Role mapping: ${role ? role.name : 'Role not found'}\n`;
                } else {
                    response += `  - No role mapping configured\n`;
                }
                response += `\n`;
            }
            
            // Invite details
            if (currentInvites.size > 0) {
                response += `📋 **Current Invites:**\n`;
                for (const [code, invite] of currentInvites) {
                    const currentUses = invite.uses;
                    const cachedUses = cachedInvites ? cachedInvites.get(code) || 0 : 0;
                    const roleId = config.inviteRoleMap[code];
                    const role = roleId ? guild.roles.cache.get(roleId) : null;
                    
                    response += `  \`${code}\` - ${currentUses} uses`;
                    if (cachedUses !== currentUses) {
                        response += ` (cached: ${cachedUses})`;
                    }
                    if (role) {
                        response += ` → ${role.name}`;
                    }
                    response += `\n`;
                }
            } else {
                response += `📋 **No regular invites found**\n`;
            }
            
            // Role mappings
            const mappings = Object.entries(config.inviteRoleMap);
            if (mappings.length > 0) {
                response += `\n🎭 **Configured Role Mappings:**\n`;
                for (const [inviteCode, roleId] of mappings) {
                    const role = guild.roles.cache.get(roleId);
                    const roleName = role ? role.name : 'Unknown Role';
                    response += `  \`${inviteCode}\` → \`${roleName}\`\n`;
                }
            }
            
            message.reply(response);
            
        } catch (error) {
            console.error(`❌ Error generating debug info:`, error);
            message.reply('❌ Error generating debug information.');
        }
    }
});

// Login to Discord
client.login(config.token);

// Export for module use
module.exports = { client, config };