using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace CookieJarTools.Whisk.Editor.Projects
{
	/// <summary>Writes the .sln that lists every generated project.</summary>
	public static class SolutionWriter
	{
		private const string CSharpProjectType = "FAE04EC0-301F-11D3-BF4B-00C04F79EFBC";

		public static string Write(IEnumerable<string> projectNames)
		{
			var names = projectNames.OrderBy(n => n).ToList();
			var sln = new StringBuilder();
			sln.Append("\r\nMicrosoft Visual Studio Solution File, Format Version 12.00\r\n# Visual Studio Version 17\r\n");
			foreach (var name in names)
			{
				sln.Append($"Project(\"{{{CSharpProjectType}}}\") = \"{name}\", \"{name}.csproj\", \"{{{StableGuid.For(name)}}}\"\r\nEndProject\r\n");
			}

			sln.Append("Global\r\n");
			sln.Append("\tGlobalSection(SolutionConfigurationPlatforms) = preSolution\r\n\t\tDebug|Any CPU = Debug|Any CPU\r\n\tEndGlobalSection\r\n");
			sln.Append("\tGlobalSection(ProjectConfigurationPlatforms) = postSolution\r\n");
			foreach (var name in names)
			{
				var guid = StableGuid.For(name);
				sln.Append($"\t\t{{{guid}}}.Debug|Any CPU.ActiveCfg = Debug|Any CPU\r\n\t\t{{{guid}}}.Debug|Any CPU.Build.0 = Debug|Any CPU\r\n");
			}

			sln.Append("\tEndGlobalSection\r\nEndGlobal\r\n");
			return sln.ToString();
		}
	}
}
