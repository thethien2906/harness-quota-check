use std::path::{Path, PathBuf};

// Tauri canonicalizes its resource directory to a Windows verbatim path.
// Node's main-module resolver cannot consume that path as a script argument.
// Simplify only when equivalent under Windows path semantics; preserve UNC.
pub fn for_node(path: &Path) -> PathBuf { dunce::simplified(path).to_path_buf() }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn converts_verbatim_paths_with_spaces_for_node() {
        assert_eq!(for_node(Path::new(r"\\?\C:\Apps\Quota Peek\resources\providers\worker.mjs")), PathBuf::from(r"C:\Apps\Quota Peek\resources\providers\worker.mjs"));
        assert_eq!(for_node(Path::new(r"\\?\UNC\server\share\Quota Peek\worker.mjs")), PathBuf::from(r"\\?\UNC\server\share\Quota Peek\worker.mjs"));
    }

    #[test]
    fn preserves_regular_paths() {
        assert_eq!(for_node(Path::new("resources/providers/worker.mjs")), PathBuf::from("resources/providers/worker.mjs"));
    }

    #[test]
    #[cfg(windows)]
    fn bundled_node_loads_worker_through_normalized_canonical_path() {
        use std::{io::{BufRead, BufReader}, process::{Command, Stdio}};
        use std::os::windows::process::CommandExt;
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").canonicalize().unwrap();
        let mut child = Command::new(for_node(&root.join("runtime/node.exe")))
            .arg("--input-type=module").arg("-e")
            .arg("import { Coordinator } from './providers/coordinator.mjs'; console.log(typeof Coordinator)")
            .current_dir(for_node(&root)).env_remove("NODE_OPTIONS")
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .creation_flags(0x08000000).spawn().unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        assert!(child.wait().unwrap().success());
        assert_eq!(line.trim(), "function");
    }

    #[test]
    #[cfg(windows)]
    fn bundled_node_accepts_normalized_script_entrypoint() {
        use std::process::{Command, Stdio};
        use std::os::windows::process::CommandExt;
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").canonicalize().unwrap();
        // This production module has no side effects or credential reads.
        let status = Command::new(for_node(&root.join("runtime/node.exe")))
            .arg(for_node(&root.join("providers/coordinator.mjs")))
            .current_dir(for_node(&root)).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .creation_flags(0x08000000).status().unwrap();
        assert!(status.success());
    }
}
