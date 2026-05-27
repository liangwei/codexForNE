use super::*;
use std::process::Command;
use std::process::Output;

const RAG_IMPORT_USAGE: &str = "Usage: /rag-import <file-or-directory>";
const NECLI_BIN_PATH_ENV: &str = "NECLI_BIN_PATH";
const NECLI_NODE_BINARY_ENV: &str = "NECLI_NODE_BINARY";

impl ChatWidget {
    pub(super) fn show_ne_rag_import_usage(&mut self) {
        self.add_error_message(RAG_IMPORT_USAGE.to_string());
    }

    pub(super) fn start_ne_rag_import(&mut self, input_path: &str) {
        let input_path = input_path.trim();
        if input_path.is_empty() {
            self.show_ne_rag_import_usage();
            return;
        }

        let cwd = self
            .current_cwd
            .clone()
            .unwrap_or_else(|| self.config.cwd.to_path_buf());
        let input_path = input_path.to_string();
        let tx = self.app_event_tx.clone();
        self.add_info_message(
            format!("Indexing local documents: {input_path}"),
            /*hint*/ None,
        );
        std::thread::spawn(move || {
            tx.send(AppEvent::NeRagImportCompleted {
                result: run_ne_rag_import(input_path, cwd),
            });
        });
    }

    pub(crate) fn on_ne_rag_import_completed(&mut self, result: Result<String, String>) {
        match result {
            Ok(output) => self.add_info_message(output, /*hint*/ None),
            Err(err) => self.add_error_message(format!("NE RAG import failed: {err}")),
        }
    }
}

fn run_ne_rag_import(input_path: String, cwd: PathBuf) -> Result<String, String> {
    let node = std::env::var(NECLI_NODE_BINARY_ENV)
        .map_err(|_| format!("{NECLI_NODE_BINARY_ENV} is not set."))?;
    let cli = std::env::var(NECLI_BIN_PATH_ENV)
        .map_err(|_| format!("{NECLI_BIN_PATH_ENV} is not set."))?;
    let output = Command::new(node)
        .arg(cli)
        .arg("rag-import")
        .arg(input_path)
        .current_dir(cwd)
        .output()
        .map_err(|err| format!("Failed to start NE RAG import helper: {err}"))?;
    rag_import_output(output)
}

fn rag_import_output(output: Output) -> Result<String, String> {
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Ok(first_non_empty([stdout.as_ref()])
            .unwrap_or("Local NE RAG import completed.")
            .to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(first_non_empty([stderr.as_ref(), stdout.as_ref()])
        .unwrap_or("NE RAG import helper exited without an error message.")
        .to_string())
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    values.into_iter().find(|value| !value.trim().is_empty())
}
