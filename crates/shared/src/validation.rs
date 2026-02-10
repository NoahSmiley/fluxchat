use crate::constants::*;

pub fn validate_server_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Server name is required".into());
    }
    if trimmed.len() > MAX_SERVER_NAME_LENGTH {
        return Err(format!(
            "Server name must be at most {} characters",
            MAX_SERVER_NAME_LENGTH
        ));
    }
    Ok(())
}

pub fn validate_channel_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Channel name is required".into());
    }
    if trimmed.len() > MAX_CHANNEL_NAME_LENGTH {
        return Err(format!(
            "Channel name must be at most {} characters",
            MAX_CHANNEL_NAME_LENGTH
        ));
    }
    // Only allow lowercase alphanumeric, hyphens, underscores
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err("Channel name can only contain lowercase letters, numbers, hyphens, and underscores".into());
    }
    Ok(())
}

pub fn validate_message_content(ciphertext: &str) -> Result<(), String> {
    if ciphertext.is_empty() {
        return Err("Message content is required".into());
    }
    if ciphertext.len() > MAX_MESSAGE_LENGTH * 2 {
        // base64 can be ~1.33x original
        return Err("Message too long".into());
    }
    Ok(())
}

pub fn validate_username(username: &str) -> Result<(), String> {
    if username.len() < MIN_USERNAME_LENGTH {
        return Err(format!(
            "Username must be at least {} characters",
            MIN_USERNAME_LENGTH
        ));
    }
    if username.len() > MAX_USERNAME_LENGTH {
        return Err(format!(
            "Username must be at most {} characters",
            MAX_USERNAME_LENGTH
        ));
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(
            "Username can only contain letters, numbers, hyphens, and underscores".into(),
        );
    }
    Ok(())
}
