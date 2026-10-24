using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using CookieJarTools.Whisk.Editor.Projects;
using Unity.CodeEditor;
using UnityEditor;
using UnityEngine;

namespace CookieJarTools.Whisk.Editor
{
	/// <summary>
	/// Whisk as one of Unity's script editors (Preferences, External Tools). When it is the chosen
	/// editor, Unity sends script opens here and asks for the project files to be kept up to date.
	/// </summary>
	public sealed class WhiskCodeEditor : IExternalCodeEditor
	{
		private const string Name = "Whisk";

		/// <summary>Files Whisk is useful for. Anything else (textures, scenes) opens in Unity's default way.</summary>
		private static readonly string[] TextExtensions =
		{
			".cs", ".shader", ".hlsl", ".cginc", ".compute", ".uss", ".uxml", ".json", ".txt", ".md", ".xml",
			".yaml", ".asmdef", ".asmref", ".rsp", ".csv", ".raytrace", ".shadergraph", ".shadersubgraph"
		};

		private readonly ProjectGenerator generator = new ProjectGenerator();

		public CodeEditor.Installation[] Installations
		{
			get
			{
				var path = WhiskLocator.Find();
				return path == null ? new CodeEditor.Installation[0] : new[] { new CodeEditor.Installation { Name = Name, Path = path } };
			}
		}

		public bool TryGetInstallationForPath(string editorPath, out CodeEditor.Installation installation)
		{
			installation = new CodeEditor.Installation { Name = Name, Path = editorPath };
			return WhiskLocator.IsWhisk(editorPath);
		}

		public void Initialize(string editorInstallationPath)
		{
		}

		public void OnGUI()
		{
			EditorGUILayout.LabelField("Whisk reads the .csproj and .sln files below for its C# support.", EditorStyles.wordWrappedMiniLabel);
			if (GUILayout.Button("Regenerate project files", GUILayout.Width(200)))
			{
				generator.Sync();
			}
		}

		public void SyncIfNeeded(string[] addedFiles, string[] deletedFiles, string[] movedFiles, string[] movedFromFiles, string[] importedFiles)
		{
			var changed = addedFiles.Concat(deletedFiles).Concat(movedFiles).Concat(movedFromFiles).Concat(importedFiles);
			if (changed.Any(ProjectGenerator.AffectsProjects))
			{
				generator.Sync();
			}
		}

		public void SyncAll()
		{
			generator.Sync();
		}

		public bool OpenProject(string filePath = "", int line = -1, int column = -1)
		{
			if (!string.IsNullOrEmpty(filePath) && !IsText(filePath))
			{
				return false;
			}

			var whisk = CodeEditor.CurrentEditorInstallation;
			if (!WhiskLocator.IsWhisk(whisk) || !File.Exists(whisk))
			{
				whisk = WhiskLocator.Find();
			}

			if (whisk == null)
			{
				UnityEngine.Debug.LogWarning("Whisk isn't installed, so the script couldn't be opened in it.");
				return false;
			}

			if (!generator.HasSolution())
			{
				generator.Sync();
			}

			Launch(whisk, filePath, line, column);
			return true;
		}

		private static bool IsText(string path)
		{
			var extension = Path.GetExtension(path).ToLowerInvariant();
			return TextExtensions.Contains(extension);
		}

		/// <summary>
		/// Starts Whisk with the project folder and the file. When Whisk is already open, the new
		/// process hands both to the open window and quits, so this never opens a second window.
		/// </summary>
		private static void Launch(string whisk, string filePath, int line, int column)
		{
			var root = ProjectGenerator.ProjectRoot;
			var arguments = $"\"{root}\"";
			if (!string.IsNullOrEmpty(filePath))
			{
				var full = Path.GetFullPath(filePath);
				arguments += $" \"{full}:{Math.Max(1, line)}:{Math.Max(1, column)}\"";
			}

			try
			{
				Process.Start(new ProcessStartInfo(whisk, arguments) { UseShellExecute = false, WorkingDirectory = root });
			}
			catch (Exception e)
			{
				UnityEngine.Debug.LogError($"Couldn't start Whisk: {e.Message}");
			}
		}
	}
}
