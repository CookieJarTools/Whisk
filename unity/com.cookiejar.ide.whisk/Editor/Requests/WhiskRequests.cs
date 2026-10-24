using System;
using System.IO;
using Unity.CodeEditor;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;

namespace CookieJarTools.Whisk.Editor.Requests
{
	/// <summary>
	/// Things Whisk asks of the Unity editor, passed as files in Library/Whisk because the two
	/// programs share nothing else. Whisk writes a request; this picks it up within half a second.
	/// <list type="bullet">
	/// <item><c>make-default</c>: choose Whisk as the script editor (written when you set up Unity in Whisk).</item>
	/// <item><c>debug-request</c>: switch to Debug code optimisation so breakpoints work, then write
	/// <c>debug-ready</c>. The switch recompiles scripts, so it is answered after the reload.</item>
	/// </list>
	/// </summary>
	[InitializeOnLoad]
	public static class WhiskRequests
	{
		private const double PollSeconds = 0.5;

		private static double nextPoll;

		private static string Folder => Path.Combine(Path.GetDirectoryName(Application.dataPath) ?? ".", "Library", "Whisk");

		static WhiskRequests()
		{
			EditorApplication.update += Poll;
		}

		private static void Poll()
		{
			if (EditorApplication.timeSinceStartup < nextPoll)
			{
				return;
			}

			nextPoll = EditorApplication.timeSinceStartup + PollSeconds;
			if (Taken("make-default"))
			{
				MakeDefault();
			}

			if (File.Exists(Path.Combine(Folder, "debug-request")))
			{
				PrepareForDebugger();
			}
		}

		private static void MakeDefault()
		{
			var whisk = WhiskLocator.Find();
			if (whisk == null)
			{
				Debug.LogWarning("Whisk asked to be the script editor, but it couldn't be found.");
				return;
			}

			CodeEditor.SetExternalScriptEditor(whisk);
			Debug.Log("Whisk is now the script editor. Change it in Preferences, External Tools.");
		}

		/// <summary>
		/// Breakpoints only bind when scripts are compiled for debugging. Switching for this
		/// session triggers a recompile, after which this runs again and reports ready.
		/// </summary>
		private static void PrepareForDebugger()
		{
			if (EditorApplication.isCompiling)
			{
				return;
			}

			if (CompilationPipeline.codeOptimization != CodeOptimization.Debug)
			{
				Debug.Log("Whisk is attaching its debugger: switching to Debug mode for this session.");
				CompilationPipeline.codeOptimization = CodeOptimization.Debug;
				return;
			}

			Taken("debug-request");
			File.WriteAllText(Path.Combine(Folder, "debug-ready"), DateTime.UtcNow.ToString("o"));
		}

		/// <summary>Removes a request file, returning whether it was there.</summary>
		private static bool Taken(string request)
		{
			var path = Path.Combine(Folder, request);
			if (!File.Exists(path))
			{
				return false;
			}

			try
			{
				File.Delete(path);
				return true;
			}
			catch (IOException)
			{
				// Whisk is still writing it; take it on the next poll.
				return false;
			}
		}
	}
}
