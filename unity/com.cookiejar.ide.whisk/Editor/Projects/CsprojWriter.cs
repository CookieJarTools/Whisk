using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security;
using System.Text;
using UnityEditor.Compilation;

namespace CookieJarTools.Whisk.Editor.Projects
{
	/// <summary>
	/// Writes one assembly as an old-style .csproj: every source file and reference listed
	/// explicitly, nothing for NuGet to restore. Language servers load this format without a
	/// build, which is why Unity's own editor packages use it too.
	/// </summary>
	public static class CsprojWriter
	{
		private const string DefaultLanguageVersion = "9.0";

		public static string Write(Assembly assembly, HashSet<string> owned, string root)
		{
			var xml = new StringBuilder();
			xml.AppendLine("<?xml version=\"1.0\" encoding=\"utf-8\"?>");
			xml.AppendLine("<!-- Written by the Whisk package for Unity. Changes here are overwritten. -->");
			xml.AppendLine("<Project ToolsVersion=\"4.0\" DefaultTargets=\"Build\" xmlns=\"http://schemas.microsoft.com/developer/msbuild/2003\">");
			AppendProperties(xml, assembly);
			AppendItems(xml, "Compile", assembly.sourceFiles.Select(f => Relative(root, f)));
			AppendReferences(xml, assembly, owned, root);
			AppendItems(xml, "Analyzer", assembly.compilerOptions.RoslynAnalyzerDllPaths.Select(p => Relative(root, p)));
			xml.AppendLine("  <Import Project=\"$(MSBuildToolsPath)\\Microsoft.CSharp.targets\" />");
			xml.AppendLine("</Project>");
			return xml.ToString();
		}

		private static void AppendProperties(StringBuilder xml, Assembly assembly)
		{
			var options = assembly.compilerOptions;
#if UNITY_2022_2_OR_NEWER
			var language = string.IsNullOrEmpty(options.LanguageVersion) ? DefaultLanguageVersion : options.LanguageVersion;
#else
			var language = DefaultLanguageVersion;
#endif
			xml.AppendLine("  <PropertyGroup>");
			Property(xml, "AssemblyName", assembly.name);
			Property(xml, "ProjectGuid", "{" + StableGuid.For(assembly.name) + "}");
			Property(xml, "OutputType", "Library");
			Property(xml, "LangVersion", language);
			Property(xml, "TargetFrameworkVersion", "v4.7.1");
			Property(xml, "DefineConstants", string.Join(";", assembly.defines));
			Property(xml, "AllowUnsafeBlocks", options.AllowUnsafeCode ? "true" : "false");
			Property(xml, "OutputPath", "Temp\\Whisk\\bin\\");
			Property(xml, "NoWarn", "0169;0649");
			// Unity supplies the whole framework as references; stop MSBuild looking for its own.
			Property(xml, "NoConfig", "true");
			Property(xml, "NoStdLib", "true");
			Property(xml, "AddAdditionalExplicitAssemblyReferences", "false");
			Property(xml, "ImplicitlyExpandNETStandardFacades", "false");
			Property(xml, "ImplicitlyExpandDesignTimeFacades", "false");
			Property(xml, "_TargetFrameworkDirectories", "non_empty_path_generated_by_whisk");
			Property(xml, "_FullFrameworkReferenceAssemblyPaths", "non_empty_path_generated_by_whisk");
			Property(xml, "DisableHandlePackageFileConflicts", "true");
			Property(xml, "ResolveNuGetPackages", "false");
			xml.AppendLine("  </PropertyGroup>");
		}

		private static void AppendReferences(StringBuilder xml, Assembly assembly, HashSet<string> owned, string root)
		{
			xml.AppendLine("  <ItemGroup>");
			foreach (var dll in assembly.compiledAssemblyReferences)
			{
				Reference(xml, dll, root);
			}

			foreach (var other in assembly.assemblyReferences.Where(a => !owned.Contains(a.name)))
			{
				Reference(xml, other.outputPath, root);
			}

			xml.AppendLine("  </ItemGroup>");
			AppendProjectReferences(xml, assembly, owned);
		}

		private static void AppendProjectReferences(StringBuilder xml, Assembly assembly, HashSet<string> owned)
		{
			var projects = assembly.assemblyReferences.Where(a => owned.Contains(a.name)).ToList();
			if (projects.Count == 0)
			{
				return;
			}

			xml.AppendLine("  <ItemGroup>");
			foreach (var other in projects)
			{
				xml.AppendLine($"    <ProjectReference Include=\"{Escape(other.name)}.csproj\">");
				xml.AppendLine($"      <Project>{{{StableGuid.For(other.name)}}}</Project>");
				xml.AppendLine($"      <Name>{Escape(other.name)}</Name>");
				xml.AppendLine("    </ProjectReference>");
			}

			xml.AppendLine("  </ItemGroup>");
		}

		private static void Reference(StringBuilder xml, string path, string root)
		{
			var name = Path.GetFileNameWithoutExtension(path);
			xml.AppendLine($"    <Reference Include=\"{Escape(name)}\">");
			xml.AppendLine($"      <HintPath>{Escape(Relative(root, path))}</HintPath>");
			xml.AppendLine("    </Reference>");
		}

		private static void AppendItems(StringBuilder xml, string item, IEnumerable<string> paths)
		{
			var list = paths.ToList();
			if (list.Count == 0)
			{
				return;
			}

			xml.AppendLine("  <ItemGroup>");
			foreach (var path in list)
			{
				xml.AppendLine($"    <{item} Include=\"{Escape(path)}\" />");
			}

			xml.AppendLine("  </ItemGroup>");
		}

		private static void Property(StringBuilder xml, string name, string value)
		{
			xml.AppendLine($"    <{name}>{Escape(value)}</{name}>");
		}

		/// <summary>
		/// Paths inside the project are written relative to it, so the files work on every machine, and
		/// with the separators of the system Unity is running on.
		/// </summary>
		private static string Relative(string root, string path)
		{
			var full = Path.GetFullPath(Path.IsPathRooted(path) ? path : Path.Combine(root, path));
			var prefix = root.TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
			var inside = full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
			return (inside ? full.Substring(prefix.Length) : full).Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);
		}

		private static string Escape(string text)
		{
			return SecurityElement.Escape(text) ?? string.Empty;
		}
	}
}
