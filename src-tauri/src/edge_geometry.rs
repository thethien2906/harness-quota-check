pub const COMPACT_SIZE: (f64, f64) = (54.0, 152.0);

pub fn window_size(mode: &str) -> (f64, f64) {
    if mode == "detail" { (354.0, 564.0) } else { COMPACT_SIZE }
}

pub fn in_trigger(cursor: (i32, i32), position: (i32, i32), size: (u32, u32), scale: f64) -> bool {
    let right = position.0 + size.0 as i32;
    let width = (5.0 * scale).ceil() as i32;
    let height = ((100.0 * scale).round() as i32).min(size.1 as i32);
    let top = position.1 + (size.1 as i32 - height) / 2;
    cursor.0 >= right - width && cursor.0 < right && cursor.1 >= top && cursor.1 < top + height
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hidden_to_compact_never_resizes_the_window() {
        assert_eq!(window_size("hidden"), window_size("compact"));
    }
    #[test]
    fn transparent_interior_is_not_a_hover_trigger() {
        assert!(!in_trigger((960, 150), (946, 100), (54, 152), 1.0));
        assert!(in_trigger((998, 150), (946, 100), (54, 152), 1.0));
        assert!(!in_trigger((998, 110), (946, 100), (54, 152), 1.0));
    }
    #[test]
    fn trigger_tracks_physical_coordinates_at_high_dpi() {
        assert!(in_trigger((1995, 350), (1892, 200), (108, 304), 2.0));
        assert!(!in_trigger((1988, 350), (1892, 200), (108, 304), 2.0));
        assert!(!in_trigger((1995, 220), (1892, 200), (108, 304), 2.0));
    }
}
