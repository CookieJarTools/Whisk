using System;
using System.Security.Cryptography;
using System.Text;

namespace CookieJarTools.Whisk.Editor.Projects
{
	/// <summary>
	/// The same GUID for the same assembly name every time, so regenerating the project files
	/// does not churn them or confuse anything that remembers projects by GUID.
	/// </summary>
	public static class StableGuid
	{
		public static string For(string name)
		{
			using (var md5 = MD5.Create())
			{
				var hash = md5.ComputeHash(Encoding.UTF8.GetBytes("whisk:" + name));
				return new Guid(hash).ToString().ToUpperInvariant();
			}
		}
	}
}
