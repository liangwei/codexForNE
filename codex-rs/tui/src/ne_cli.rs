use std::process::Command;

const NODE_BINARY_ENV: &str = "NECLI_NODE_BINARY";
const AUTH_HELPER_ENV: &str = "NECLI_AUTH_HELPER";

pub(crate) fn save_default_model(model: &str) -> Result<(), String> {
    let node =
        std::env::var(NODE_BINARY_ENV).map_err(|_| format!("{NODE_BINARY_ENV} is not set."))?;
    let helper =
        std::env::var(AUTH_HELPER_ENV).map_err(|_| format!("{AUTH_HELPER_ENV} is not set."))?;
    let output = Command::new(node)
        .arg(helper)
        .arg("models")
        .arg("default")
        .arg(model)
        .output()
        .map_err(|err| format!("Failed to start NE model helper: {err}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(first_non_empty([stderr.as_ref(), stdout.as_ref()])
        .unwrap_or("NE model helper exited without an error message.")
        .to_string())
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    values.into_iter().find(|value| !value.trim().is_empty())
}
