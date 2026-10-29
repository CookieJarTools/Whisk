using System;
using System.IO;
using Microsoft.Win32;
using UnityEngine;

namespace CookieJarTools.Whisk.Editor
{
	/// <summary>
	/// Finds where Whisk is installed. On Windows the installer records its folder in the registry, and
	/// the default install folder is the fallback for copies installed before it did. On Linux an AppImage
	/// can live anywhere, so Whisk writes its own path to ~/.whisk/install-path each time it starts, and
	/// the place the .deb and .rpm packages install it is the fallback.
	/// </summary>
	public static class WhiskLocator
	{
		public const string ExeName = "whisk.exe";

		private const string InstallKey = @"Software\CookieJarTools\Whisk";

		private const string LinuxName = "whisk";

		private const string LinuxPackagePath = "/usr/bin/whisk";

		/// <summary>The full path to Whisk, or null when Whisk is not installed.</summary>
		public static string Find()
		{
			return Application.platform == RuntimePlatform.WindowsEditor ? FindOnWindows() : FindOnLinux();
		}

		public static bool IsWhisk(string path)
		{
			if (string.IsNullOrEmpty(path))
			{
				return false;
			}

			var name = Path.GetFileName(path);
			return string.Equals(name, ExeName, StringComparison.OrdinalIgnoreCase) || name == LinuxName || IsAppImage(name);
		}

		/// <summary>An AppImage keeps the name it was downloaded with, such as Whisk_0.3.0_amd64.AppImage, even after it updates.</summary>
		private static bool IsAppImage(string name)
		{
			return name.StartsWith("Whisk", StringComparison.OrdinalIgnoreCase) && name.EndsWith(".AppImage", StringComparison.OrdinalIgnoreCase);
		}

		private static string FindOnWindows()
		{
			var fromRegistry = FromRegistry();
			if (fromRegistry != null)
			{
				return fromRegistry;
			}

			var local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Whisk", ExeName);
			return File.Exists(local) ? local : null;
		}

		private static string FindOnLinux()
		{
			var recorded = FromRecordedPath();
			if (recorded != null)
			{
				return recorded;
			}

			return File.Exists(LinuxPackagePath) ? LinuxPackagePath : null;
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

		private static string FromRecordedPath()
		{
			var record = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".whisk", "install-path");
			try
			{
				var path = File.Exists(record) ? File.ReadAllText(record).Trim() : null;
				return !string.IsNullOrEmpty(path) && File.Exists(path) ? path : null;
			}
			catch (IOException)
			{
				// Whisk is writing it at this moment: fall back to the package location.
				return null;
			}
		}
	}
}
