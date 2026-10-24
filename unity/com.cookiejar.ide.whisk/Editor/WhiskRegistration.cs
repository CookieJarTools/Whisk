using Unity.CodeEditor;
using UnityEditor;

namespace CookieJarTools.Whisk.Editor
{
	/// <summary>Puts Whisk in Unity's list of script editors as soon as the editor loads.</summary>
	[InitializeOnLoad]
	public static class WhiskRegistration
	{
		static WhiskRegistration()
		{
			CodeEditor.Register(new WhiskCodeEditor());
		}
	}
}
