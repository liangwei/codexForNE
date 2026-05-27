pub(crate) fn ne_permission_description(description: &str) -> String {
    description
        .replace("Codex", "NE-CLI")
        .replace(" (Identical to Agent mode)", "")
}
