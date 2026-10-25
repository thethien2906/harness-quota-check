# PRIVATE PIPE ONLY: the Node adapter captures stdout in memory. Never invoke
# this helper from a diagnostic command that prints its output.
$ErrorActionPreference = 'Stop'
try {
 Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class QuotaPeekCredential {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 private struct Credential {
  public uint Flags, Type; public string TargetName, Comment; public long LastWritten;
  public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist, AttributeCount;
  public IntPtr Attributes; public string TargetAlias, UserName;
 }
 [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
 private static extern bool CredRead(string target, uint type, uint flags, out IntPtr value);
 [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr value);
 public static string ReadAntigravity() {
  IntPtr pointer;
  // Exact service/account used by Antigravity CLI through go-keyring.
  // No credential enumeration and no access to any other saved password.
  if (!CredRead("gemini:antigravity", 1, 0, out pointer)) return null;
  try {
   var value = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
   if (value.CredentialBlobSize == 0 || value.CredentialBlobSize > 65536) return null;
   var bytes = new byte[value.CredentialBlobSize];
   Marshal.Copy(value.CredentialBlob, bytes, 0, bytes.Length);
   try { return Encoding.UTF8.GetString(bytes); } finally { Array.Clear(bytes, 0, bytes.Length); }
  } finally { CredFree(pointer); }
 }
}
'@
 $value = [QuotaPeekCredential]::ReadAntigravity()
 if ($value) { [Console]::Write($value) }
} catch { exit 1 }
