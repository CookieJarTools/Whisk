using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor.Compilation;
using UnityEditor.PackageManager;
using UnityEngine;
using Assembly = UnityEditor.Compilation.Assembly;

namespace CookieJarTools.Whisk.Editor.Projects
{
	/// <summary>
	/// Writes a .csproj for each of the project's own assemblies (Assets, and embedded or local
	/// packages) and a .sln listing them, which is what Whisk's C# language server reads.
	/// Packages from the registry are referenced as compiled DLLs, as Rider does by default.
	/// </summary>
	public sealed class ProjectGenerator
	{
		private const string OwnAssembly = "CookieJarTools.Whisk.Editor";

		private static readonly string[] ProjectInputs = { ".cs", ".asmdef", ".asmref", ".dll", ".rsp" };

		public static string ProjectRoot => Directory.GetParent(Application.dataPath).FullName;

		public static string SolutionPath => Path.Combine(ProjectRoot, Path.GetFileName(ProjectRoot) + ".sln");

		public static bool AffectsProjects(string path)
		{
			var extension = Path.GetExtension(path).ToLowerInvariant();
			return ProjectInputs.Contains(extension);
		}

		public bool HasSolution()
		{
			return File.Exists(SolutionPath);
		}

		public void Sync()
		{
			var assemblies = CompilationPipeline.GetAssemblies(AssembliesType.Editor);
			var owned = new HashSet<string>(assemblies.Where(IsOwned).Select(a => a.name));
			var projects = new List<Assembly>();
			foreach (var assembly in assemblies)
			{
				if (owned.Contains(assembly.name))
				{
					WriteIfChanged(Path.Combine(ProjectRoot, assembly.name + ".csproj"), CsprojWriter.Write(assembly, owned, ProjectRoot));
					projects.Add(assembly);
				}
			}

			WriteIfChanged(SolutionPath, SolutionWriter.Write(projects.Select(p => p.name)));
		}

		/// <summary>True for assemblies whose code lives in this project rather than in a registry package.</summary>
		private static bool IsOwned(Assembly assembly)
		{
			if (assembly.name == OwnAssembly || assembly.sourceFiles.Length == 0)
			{
				return false;
			}

			var first = assembly.sourceFiles[0];
			if (first.StartsWith("Assets/", StringComparison.Ordinal))
			{
				return true;
			}

			var package = PackageInfo.FindForAssetPath(first);
			return package != null && (package.source == PackageSource.Embedded || package.source == PackageSource.Local);
		}

		/// <summary>
		/// Leaves files alone when nothing changed, so the language server does not reload the
		/// whole solution every time a script is saved.
		/// </summary>
		private static void WriteIfChanged(string path, string content)
		{
			if (File.Exists(path) && File.ReadAllText(path) == content)
			{
				return;
			}

			File.WriteAllText(path, content, new UTF8Encoding(true));
		}
	}
}
