//! Valve KeyValues text parser (VMT materials, `items_game.txt`, ...).
//! Keys are kept in file order and duplicates are preserved; lookups are
//! case-insensitive like the engine's.

use crate::binary::{fail, Result};

#[derive(Debug, Clone)]
pub struct Node {
    pub key: String,
    pub value: Value,
}

#[derive(Debug, Clone)]
pub enum Value {
    Str(String),
    Block(Vec<Node>),
}

impl Node {
    pub fn as_str(&self) -> Option<&str> {
        match &self.value {
            Value::Str(s) => Some(s),
            Value::Block(_) => None,
        }
    }

    pub fn block(&self) -> Option<&[Node]> {
        match &self.value {
            Value::Block(b) => Some(b),
            Value::Str(_) => None,
        }
    }
}

/// First node with the given key (ASCII case-insensitive).
pub fn find<'a>(nodes: &'a [Node], key: &str) -> Option<&'a Node> {
    nodes.iter().find(|n| n.key.eq_ignore_ascii_case(key))
}

#[derive(Debug, PartialEq)]
enum Tok {
    Str(String),
    Open,
    Close,
    /// `[$WIN32]`-style platform conditional following a value.
    Cond(String),
}

fn tokenize(text: &str) -> Result<Vec<Tok>> {
    let mut toks = Vec::new();
    let mut it = text.chars().peekable();
    while let Some(&c) = it.peek() {
        match c {
            c if c.is_whitespace() || c == '\u{feff}' => {
                it.next();
            }
            '/' => {
                it.next();
                if it.peek() == Some(&'/') {
                    while it.next_if(|&c| c != '\n').is_some() {}
                } else {
                    return fail("stray '/' in KeyValues");
                }
            }
            '{' => {
                it.next();
                toks.push(Tok::Open);
            }
            '}' => {
                it.next();
                toks.push(Tok::Close);
            }
            '"' => {
                it.next();
                let mut s = String::new();
                loop {
                    match it.next() {
                        None => return fail("unterminated string in KeyValues"),
                        Some('"') => break,
                        Some('\\') if it.peek() == Some(&'"') => {
                            it.next();
                            s.push('"');
                        }
                        Some(c) => s.push(c),
                    }
                }
                toks.push(Tok::Str(s));
            }
            _ => {
                let mut s = String::new();
                while let Some(c) = it.next_if(|&c| !c.is_whitespace() && !matches!(c, '"' | '{' | '}')) {
                    s.push(c);
                }
                if s.starts_with('[') {
                    toks.push(Tok::Cond(s));
                } else {
                    toks.push(Tok::Str(s));
                }
            }
        }
    }
    Ok(toks)
}

/// Whether a `[...]` conditional is active on a Windows PC.
fn cond_active(cond: &str) -> bool {
    let inner = cond.trim_matches(|c| c == '[' || c == ']');
    let (negated, name) = match inner.strip_prefix('!') {
        Some(n) => (true, n),
        None => (false, inner),
    };
    let is_pc = matches!(name.to_ascii_uppercase().as_str(), "$WIN32" | "$WINDOWS");
    is_pc != negated
}

fn parse_block(toks: &[Tok], pos: &mut usize, nested: bool) -> Result<Vec<Node>> {
    let mut out = Vec::new();
    loop {
        let Some(tok) = toks.get(*pos) else {
            return if nested { fail("missing '}' in KeyValues") } else { Ok(out) };
        };
        *pos += 1;
        let key = match tok {
            Tok::Close if nested => return Ok(out),
            Tok::Close => return fail("unexpected '}' in KeyValues"),
            Tok::Str(k) => k.clone(),
            other => return fail(format!("unexpected token {other:?} where a key was expected")),
        };
        let value = match toks.get(*pos) {
            Some(Tok::Open) => {
                *pos += 1;
                Value::Block(parse_block(toks, pos, true)?)
            }
            Some(Tok::Str(v)) => {
                *pos += 1;
                Value::Str(v.clone())
            }
            _ => return fail(format!("key '{key}' has no value")),
        };
        let keep = match toks.get(*pos) {
            Some(Tok::Cond(c)) => {
                *pos += 1;
                cond_active(c)
            }
            _ => true,
        };
        if keep {
            out.push(Node { key, value });
        }
    }
}

pub fn parse(text: &str) -> Result<Vec<Node>> {
    let toks = tokenize(text)?;
    let mut pos = 0;
    parse_block(&toks, &mut pos, false)
}
