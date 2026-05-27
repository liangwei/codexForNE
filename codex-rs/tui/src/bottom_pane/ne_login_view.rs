use std::cell::RefCell;
use std::env;
use std::io::Write;
use std::process::Command;
use std::process::Stdio;
use std::thread;

use crossterm::event::KeyCode;
use crossterm::event::KeyEvent;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Stylize;
use ratatui::text::Line;
use ratatui::text::Span;
use ratatui::widgets::Clear;
use ratatui::widgets::Paragraph;
use ratatui::widgets::StatefulWidgetRef;
use ratatui::widgets::Widget;

use crate::app_event::AppEvent;
use crate::app_event::NeLoginResult;
use crate::app_event_sender::AppEventSender;
use crate::render::renderable::Renderable;

use super::CancellationEvent;
use super::bottom_pane_view::BottomPaneView;
use super::bottom_pane_view::ViewCompletion;
use super::popup_consts::standard_popup_hint_line;
use super::textarea::TextArea;
use super::textarea::TextAreaState;

const LABEL_WIDTH: u16 = 12;
const VIEW_HEIGHT: u16 = 5;
const MASK_CHAR: char = '*';
const NODE_BINARY_ENV: &str = "NECLI_NODE_BINARY";
const AUTH_HELPER_ENV: &str = "NECLI_AUTH_HELPER";

enum LoginStep {
    Username,
    Password,
}

/// Collects NE account credentials and invokes the packaged NE auth helper.
pub(crate) struct NeLoginView {
    step: LoginStep,
    username: TextArea,
    password: TextArea,
    username_state: RefCell<TextAreaState>,
    password_state: RefCell<TextAreaState>,
    app_event_tx: AppEventSender,
    completion: Option<ViewCompletion>,
}

impl NeLoginView {
    pub(crate) fn new(app_event_tx: AppEventSender) -> Self {
        Self {
            step: LoginStep::Username,
            username: TextArea::new(),
            password: TextArea::new(),
            username_state: RefCell::new(TextAreaState::default()),
            password_state: RefCell::new(TextAreaState::default()),
            app_event_tx,
            completion: None,
        }
    }

    fn submit_current_step(&mut self) {
        match self.step {
            LoginStep::Username => self.submit_username(),
            LoginStep::Password => self.submit_password(),
        }
    }

    fn submit_username(&mut self) {
        if self.username.text().trim().is_empty() {
            return;
        }
        self.step = LoginStep::Password;
    }

    fn submit_password(&mut self) {
        let password = self.password.text().to_string();
        if password.is_empty() {
            return;
        }
        let username = self.username.text().trim().to_string();
        let tx = self.app_event_tx.clone();
        thread::spawn(move || {
            tx.send(AppEvent::NeLoginCompleted {
                result: run_ne_login(username, password),
            });
        });
        self.completion = Some(ViewCompletion::Accepted);
    }

    fn active_textarea_mut(&mut self) -> &mut TextArea {
        match self.step {
            LoginStep::Username => &mut self.username,
            LoginStep::Password => &mut self.password,
        }
    }

    fn active_textarea(&self) -> (&TextArea, TextAreaState, RectRow) {
        match self.step {
            LoginStep::Username => (
                &self.username,
                *self.username_state.borrow(),
                RectRow::Username,
            ),
            LoginStep::Password => (
                &self.password,
                *self.password_state.borrow(),
                RectRow::Password,
            ),
        }
    }
}

impl BottomPaneView for NeLoginView {
    fn handle_key_event(&mut self, key_event: KeyEvent) {
        match key_event.code {
            KeyCode::Esc => {
                self.on_ctrl_c();
            }
            KeyCode::Enter => {
                self.submit_current_step();
            }
            _ => {
                self.active_textarea_mut().input(key_event);
            }
        }
    }

    fn is_complete(&self) -> bool {
        self.completion.is_some()
    }

    fn completion(&self) -> Option<ViewCompletion> {
        self.completion
    }

    fn on_ctrl_c(&mut self) -> CancellationEvent {
        self.completion = Some(ViewCompletion::Cancelled);
        CancellationEvent::Handled
    }

    fn handle_paste(&mut self, pasted: String) -> bool {
        if pasted.is_empty() {
            return false;
        }
        self.active_textarea_mut().insert_str(&pasted);
        true
    }
}

impl Renderable for NeLoginView {
    fn desired_height(&self, _width: u16) -> u16 {
        VIEW_HEIGHT
    }

    fn render(&self, area: Rect, buf: &mut Buffer) {
        if area.height == 0 || area.width == 0 {
            return;
        }
        Paragraph::new(Line::from(vec![Span::raw("> "), "NE Login".bold()]))
            .render(row_rect(area, 0), buf);
        self.render_input_row(area, buf, RectRow::Username);
        self.render_input_row(area, buf, RectRow::Password);
        Paragraph::new(standard_popup_hint_line()).render(row_rect(area, 4), buf);
    }

    fn cursor_pos(&self, area: Rect) -> Option<(u16, u16)> {
        let (textarea, state, row) = self.active_textarea();
        textarea.cursor_pos_with_state(input_rect(area, row), state)
    }
}

impl NeLoginView {
    fn render_input_row(&self, area: Rect, buf: &mut Buffer, row: RectRow) {
        let (label, textarea, state) = self.row_parts(row);
        Paragraph::new(Line::from(vec![label.cyan()])).render(label_rect(area, row), buf);
        let rect = input_rect(area, row);
        Clear.render(rect, buf);
        let mut state = state.borrow_mut();
        match row {
            RectRow::Username => {
                StatefulWidgetRef::render_ref(&(&self.username), rect, buf, &mut state)
            }
            RectRow::Password => textarea.render_ref_masked(rect, buf, &mut state, MASK_CHAR),
        }
        if textarea.text().is_empty() {
            Paragraph::new(Line::from(self.placeholder(row).dim())).render(rect, buf);
        }
    }

    fn row_parts(&self, row: RectRow) -> (&'static str, &TextArea, &RefCell<TextAreaState>) {
        match row {
            RectRow::Username => ("Account", &self.username, &self.username_state),
            RectRow::Password => ("Password", &self.password, &self.password_state),
        }
    }

    fn placeholder(&self, row: RectRow) -> &'static str {
        match row {
            RectRow::Username => "email / phone / account",
            RectRow::Password => "password",
        }
    }
}

#[derive(Clone, Copy)]
enum RectRow {
    Username,
    Password,
}

fn run_ne_login(username: String, password: String) -> Result<NeLoginResult, String> {
    let node = env::var(NODE_BINARY_ENV).map_err(|_| format!("{NODE_BINARY_ENV} is not set."))?;
    let helper = env::var(AUTH_HELPER_ENV).map_err(|_| format!("{AUTH_HELPER_ENV} is not set."))?;
    let output = run_ne_login_helper(&node, &helper, &username, &password)?;
    parse_ne_login_output(output)
}

fn run_ne_login_helper(
    node: &str,
    helper: &str,
    username: &str,
    password: &str,
) -> Result<std::process::Output, String> {
    let mut child = Command::new(node)
        .arg(helper)
        .arg("login")
        .arg("--username")
        .arg(username)
        .arg("--json")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start NE login helper: {err}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open NE login helper stdin.".to_string())?;
    stdin
        .write_all(password.as_bytes())
        .map_err(|err| format!("Failed to write NE password to helper stdin: {err}"))?;
    drop(stdin);
    child
        .wait_with_output()
        .map_err(|err| format!("NE login helper failed: {err}"))
}

fn parse_ne_login_output(output: std::process::Output) -> Result<NeLoginResult, String> {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(first_non_empty([stderr.as_str(), stdout.as_str()])
            .unwrap_or("NE login helper exited without an error message.")
            .to_string());
    }
    serde_json::from_str::<NeLoginResult>(&stdout)
        .map_err(|err| format!("NE login helper returned invalid model data: {err}"))
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    values.into_iter().find(|value| !value.trim().is_empty())
}

fn row_rect(area: Rect, offset: u16) -> Rect {
    Rect {
        x: area.x,
        y: area.y.saturating_add(offset),
        width: area.width,
        height: 1,
    }
}

fn label_rect(area: Rect, row: RectRow) -> Rect {
    Rect {
        x: area.x,
        y: row_y(area, row),
        width: LABEL_WIDTH.min(area.width),
        height: 1,
    }
}

fn input_rect(area: Rect, row: RectRow) -> Rect {
    Rect {
        x: area.x.saturating_add(LABEL_WIDTH),
        y: row_y(area, row),
        width: area.width.saturating_sub(LABEL_WIDTH),
        height: 1,
    }
}

fn row_y(area: Rect, row: RectRow) -> u16 {
    let offset = match row {
        RectRow::Username => 1,
        RectRow::Password => 2,
    };
    area.y.saturating_add(offset)
}
