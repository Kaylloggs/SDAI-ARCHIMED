//! Export iCalendar (RFC 5545) : importable dans Google Agenda, Outlook, Apple Calendar.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub uid: String,
    pub title: String,
    /// `AAAA-MM-JJ` : événement « journée entière ».
    pub date: String,
    pub description: Option<String>,
}

/// Échappement des valeurs texte (RFC 5545 §3.3.11).
fn escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace("\r\n", "\\n")
        .replace('\n', "\\n")
}

/// Repli des lignes à 75 octets (RFC 5545 §3.1), sans couper un caractère UTF-8.
fn fold(line: &str) -> String {
    let mut out = String::new();
    let mut count = 0;
    for ch in line.chars() {
        let len = ch.len_utf8();
        if count + len > 75 {
            out.push_str("\r\n ");
            count = 1;
        }
        out.push(ch);
        count += len;
    }
    out
}

/// `AAAA-MM-JJ` → (`AAAAMMJJ`, lendemain `AAAAMMJJ`). `None` si la date est invalide.
fn day_bounds(date: &str) -> Option<(String, String)> {
    let day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    let next = day.succ_opt()?;
    Some((day.format("%Y%m%d").to_string(), next.format("%Y%m%d").to_string()))
}

pub fn build(calendar_name: &str, events: &[CalendarEvent]) -> String {
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//SDAI//ARCHIMED Planner//FR".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
        fold(&format!("X-WR-CALNAME:{}", escape(calendar_name))),
    ];

    for event in events {
        let Some((start, end)) = day_bounds(&event.date) else {
            continue;
        };
        lines.push("BEGIN:VEVENT".to_string());
        lines.push(fold(&format!("UID:{}@archimed", escape(&event.uid))));
        lines.push(format!("DTSTAMP:{stamp}"));
        lines.push(format!("DTSTART;VALUE=DATE:{start}"));
        lines.push(format!("DTEND;VALUE=DATE:{end}"));
        lines.push(fold(&format!("SUMMARY:{}", escape(&event.title))));
        if let Some(description) = &event.description {
            lines.push(fold(&format!("DESCRIPTION:{}", escape(description))));
        }
        lines.push("END:VEVENT".to_string());
    }

    lines.push("END:VCALENDAR".to_string());
    lines.join("\r\n") + "\r\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_all_day_events_and_skips_invalid_dates() {
        let ics = build(
            "Roadmap, projet",
            &[
                CalendarEvent {
                    uid: "c1".into(),
                    title: "Livrer; la v1".into(),
                    date: "2026-12-31".into(),
                    description: Some("ligne 1\nligne 2".into()),
                },
                CalendarEvent {
                    uid: "c2".into(),
                    title: "Invalide".into(),
                    date: "31/12/2026".into(),
                    description: None,
                },
            ],
        );
        assert!(ics.starts_with("BEGIN:VCALENDAR\r\n"));
        assert!(ics.contains("X-WR-CALNAME:Roadmap\\, projet"));
        assert!(ics.contains("DTSTART;VALUE=DATE:20261231"));
        assert!(ics.contains("DTEND;VALUE=DATE:20270101"));
        assert!(ics.contains("SUMMARY:Livrer\\; la v1"));
        assert!(ics.contains("DESCRIPTION:ligne 1\\nligne 2"));
        assert_eq!(ics.matches("BEGIN:VEVENT").count(), 1);
    }

    #[test]
    fn folds_long_lines() {
        let folded = fold(&"é".repeat(60));
        assert!(folded.split("\r\n ").all(|part| part.len() <= 75));
    }
}
