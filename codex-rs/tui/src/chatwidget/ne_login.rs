use super::*;
use crate::bottom_pane::NeLoginView;
use std::process::Command;

impl ChatWidget {
    pub(super) fn open_ne_login_prompt(&mut self) {
        self.bottom_pane
            .show_view(Box::new(NeLoginView::new(self.app_event_tx.clone())));
    }

    pub(super) fn start_ne_logout(&mut self) {
        let tx = self.app_event_tx.clone();
        std::thread::spawn(move || {
            tx.send(AppEvent::NeLogoutCompleted {
                result: run_ne_logout(),
            });
        });
    }

    pub(super) fn show_ne_login_prompt_if_needed(&mut self) {
        if self.ne_login_required() {
            self.add_info_message(
                "NE login required.".to_string(),
                Some("Run /login before sending messages.".to_string()),
            );
        }
    }
}

fn run_ne_logout() -> Result<(), String> {
    let node = std::env::var("NECLI_NODE_BINARY")
        .map_err(|_| "NECLI_NODE_BINARY is not set.".to_string())?;
    let helper = std::env::var("NECLI_AUTH_HELPER")
        .map_err(|_| "NECLI_AUTH_HELPER is not set.".to_string())?;
    let output = Command::new(node)
        .arg(helper)
        .arg("logout")
        .output()
        .map_err(|err| format!("Failed to start NE logout helper: {err}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(first_non_empty([stderr.as_ref(), stdout.as_ref()])
        .unwrap_or("NE logout helper exited without an error message.")
        .to_string())
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    values.into_iter().find(|value| !value.trim().is_empty())
}
