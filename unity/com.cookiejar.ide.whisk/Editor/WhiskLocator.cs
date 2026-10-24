using System;
using System.IO;
using Microsoft.Win32;

namespace CookieJarTools.Whisk.Editor
{
	/// <summary>
	/// Finds where Whisk is installed. The installer records its folder in the registry; the
	/// default install folder is the fallback for copies installed before it did.
	/// </summary>
	public static class WhiskLocator
	{
		public const string ExeName = "whisk.exe";

		private const string InstallKey = @"Software\CookieJarTools\Whisk";

		/// <summary>The full path to whisk.exe, or null when Whisk is not installed.</summary>
		public static string Find()
		{
			var fromRegistry = FromRegistry();
			if (fromRegistry != null)
			{
				return fromRegistry;
			}

			var local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Whisk", ExeName);
			return File.Exists(local) ? local : null;
		}

		public static bool IsWhisk(string path)
		{
			return !string.IsNullOrEmpty(path) && string.Equals(Path.GetFileName(path), ExeName, StringComparison.OrdinalIgnoreCase);
		}

		private static string FromRegistry()
		{
			try
			{
				using (var key = Registry.CurrentUser.OpenSubKey(InstallKey))
				{
					var folder = key?.GetValue(null) as string;
					var exe = string.IsNullOrEmpty(folder) ? null : Path.Combine(folder.Trim('"'), ExeName);
					return exe != null && File.Exists(exe) ? exe : null;
				}
			}
			catch (Exception)
			{
				// No registry on this platform, or no permission: fall back to the default folder.
				return null;
			}
		}
	}
}
