const { commands } = require('./register-commands.js');

console.log(`\n🔍 Validating ${commands.length} commands...\n`);

let errors = [];
let warnings = [];

commands.forEach((cmd, i) => {
    // Check command name length (max 32 chars)
    if (cmd.name && cmd.name.length > 32) {
        errors.push(`Command ${i+1} (${cmd.name}): Name too long (${cmd.name.length} chars, max 32)`);
    }
    
    // Check command description length (max 100 chars)
    if (cmd.description && cmd.description.length > 100) {
        errors.push(`Command ${i+1} (${cmd.name}): Description too long (${cmd.description.length} chars, max 100)`);
    }
    
    // Check options
    if (cmd.options && Array.isArray(cmd.options)) {
        cmd.options.forEach((opt, j) => {
            // Check option name length (max 32 chars)
            if (opt.name && opt.name.length > 32) {
                errors.push(`Command ${i+1} (${cmd.name}), Option ${j+1} (${opt.name}): Name too long (${opt.name.length} chars, max 32)`);
            }
            
            // Check option description length (max 100 chars)
            if (opt.description && opt.description.length > 100) {
                errors.push(`Command ${i+1} (${cmd.name}), Option ${j+1} (${opt.name}): Description too long (${opt.description.length} chars, max 100)`);
            }
            
            // Check for required after optional
            if (j > 0 && cmd.options[j-1].required === false && opt.required === true) {
                warnings.push(`Command ${i+1} (${cmd.name}): Optional option "${cmd.options[j-1].name}" before required option "${opt.name}"`);
            }
        });
        
        // Check max 25 options
        if (cmd.options.length > 25) {
            errors.push(`Command ${i+1} (${cmd.name}): Too many options (${cmd.options.length}, max 25)`);
        }
    }
});

// Check total commands (max 100 global commands)
if (commands.length > 100) {
    warnings.push(`Total commands: ${commands.length} (Discord allows max 100 global commands)`);
}

console.log('📊 Validation Results:\n');

if (errors.length > 0) {
    console.log('❌ ERRORS (will cause registration to fail):');
    errors.forEach(err => console.log(`   - ${err}`));
    console.log('');
}

if (warnings.length > 0) {
    console.log('⚠️  WARNINGS (may cause issues):');
    warnings.forEach(warn => console.log(`   - ${warn}`));
    console.log('');
}

if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ No validation errors found!');
    console.log('   All commands should register successfully.\n');
    process.exit(0);
} else if (errors.length > 0) {
    console.log(`\n❌ Found ${errors.length} error(s) that will prevent registration.`);
    process.exit(1);
} else {
    console.log(`\n⚠️  Found ${warnings.length} warning(s) but registration should succeed.`);
    process.exit(0);
}





