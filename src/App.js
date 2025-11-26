import React, { useState, useEffect, useRef } from "react";

// --- Configuration ---
const TYPING_SPEED = 30; // Milliseconds per character for typing simulation

// --- Static Netflix Catalog for RAG Demonstration ---
const NETFLIX_CATALOG = [
  {
    title: "The Midnight Sky",
    year: 2020,
    genre: "Sci-Fi, Drama",
    director: "George Clooney",
    rating: 7.0,
    summary:
      "A lone scientist in the Arctic races to stop a team of astronauts from returning home to a mysterious global catastrophe.",
  },
  {
    title: "Queen's Gambit",
    year: 2020,
    genre: "Drama",
    director: "Scott Frank",
    rating: 9.2,
    summary:
      "Orphaned chess prodigy Beth Harmon fights addiction and prejudice in her quest to become the world's greatest chess player.",
  },
  {
    title: "Squid Game",
    year: 2021,
    genre: "Thriller, Survival",
    director: "Hwang Dong-hyuk",
    rating: 8.0,
    summary:
      "Hundreds of cash-strapped contestants accept a strange invitation to compete in children's games for a tempting prize, but the stakes are deadly.",
  },
  {
    title: "The Crown",
    year: 2016,
    genre: "Historical Drama",
    director: "Peter Morgan",
    rating: 8.7,
    summary:
      "Follows the political rivalries and romance of Queen Elizabeth II's reign, and the events that shaped the second half of the 20th century.",
  },
];

// --- RAG (Retrieval-Augmented Generation) Logic ---

/**
 * Simulates retrieving relevant context from the Netflix catalog based on the query.
 * IMPORTANT: Logic updated to strictly ensure that if a specific, but unknown, title is queried,
 * no context is passed, forcing the model to rely on the refusal instruction.
 * @param {string} query - The user's input.
 * @returns {string} - A stringified JSON of the relevant entries, or an empty string.
 */
const getNetflixContext = (query) => {
  const lowerQuery = query.toLowerCase();

  // 1. Check for specific title match
  const relevantItems = NETFLIX_CATALOG.filter((item) =>
    lowerQuery.includes(item.title.toLowerCase())
  );
  if (relevantItems.length > 0) {
    // Specific title found
    return JSON.stringify(relevantItems, null, 2);
  }

  // 2. Check for general recommendation/metadata query (e.g., "highest rated," "sci-fi," "director")
  const generalKeywords = [
    "recommend",
    "rating",
    "director",
    "genre",
    "show me",
    "about",
  ];
  const isGeneralCatalogQuery =
    generalKeywords.some((keyword) => lowerQuery.includes(keyword)) ||
    NETFLIX_CATALOG.some((item) =>
      lowerQuery.includes(item.genre.toLowerCase())
    );

  if (isGeneralCatalogQuery) {
    // General catalog query, provide all data for comparison/summary
    return JSON.stringify(NETFLIX_CATALOG, null, 2);
  }

  // 3. If the query is an explicit but unknown title (like 'Stranger Things') or completely out-of-scope (like 'What is JavaScript?'),
  // return NO RAG context ("") to enforce reliance on the strict system prompt for refusal.
  return "";
};

/**
 * Custom hook for managing the scroll position of the chat container.
 * It automatically scrolls to the bottom when messages change.
 */
const useChatScroll = (deps) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, deps);
  return ref;
};

/**
 * A component to display an individual chat message bubble.
 */
const ChatBubble = ({ role, text, isStreaming = false }) => {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`
        max-w-[85%] md:max-w-[70%] p-3 rounded-xl shadow-lg transition duration-300
        ${
          isUser
            ? "bg-blue-600 text-white rounded-br-none"
            : "bg-gray-100 border border-gray-200 text-gray-800 rounded-tl-none"
        }
      `}
      >
        {/* Use whitespace-pre-wrap to handle line breaks from the model response */}
        <pre className="whitespace-pre-wrap font-sans text-sm">{text}</pre>
        {isStreaming && (
          <span className="inline-block w-2 h-2 ml-1 bg-gray-500 rounded-full animate-ping"></span>
        )}
      </div>
    </div>
  );
};

/**
 * The main Chatbot component.
 */
const App = () => {
  const [userInput, setUserInput] = useState("");
  const [chatHistory, setChatHistory] = useState([
    {
      role: "model",
      parts: [
        {
          text: "Hello! I am your personalized Netflix Chatbot. Ask me about our titles, like 'Queen's Gambit' or 'recommend a sci-fi show'.",
        },
      ],
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState(null);

  // Auto-scroll chat window
  const chatMessagesRef = useChatScroll([chatHistory, streamingText]);

  /**
   * Simulates the typing effect for the model's response.
   */
  const startTypingEffect = (fullText) => {
    let index = 0;
    setStreamingText("");

    // Clear history item that was streaming to prepare for final commit
    setChatHistory((prev) =>
      prev.filter((msg) => msg.role !== "streaming_model")
    );

    const intervalId = setInterval(() => {
      if (index < fullText.length) {
        setStreamingText((prev) => prev + fullText.charAt(index));
        index++;
      } else {
        clearInterval(intervalId);
        // Once typing is complete, commit the full message to chat history
        setChatHistory((prev) => [
          ...prev,
          { role: "model", parts: [{ text: fullText }] },
        ]);
        setStreamingText("");
      }
    }, TYPING_SPEED);

    // Cleanup function for the interval
    return () => clearInterval(intervalId);
  };

  /**
   * Handles the API call to Gemini with exponential backoff for retries.
   */
  const callGeminiApi = async (history, systemInstruction) => {
    const payload = { history, systemInstruction };

    const res = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history, systemInstruction }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Unknown server error");
    }

    const data = await res.json();
    return data.reply;
  };

  /**
   * Sends the user's message to the Gemini API and starts the typing simulation.
   */
  const sendMessage = async () => {
    const text = userInput.trim();
    if (!text || isLoading || streamingText) return;

    // --- RAG INTEGRATION ---
    const contextData = getNetflixContext(text);

    let systemPrompt;
    const augmentedUserQuery = text;

    // Base System Prompt: Defines the persona and the strict scope constraint
    const baseSystemPrompt = `You are a Netflix catalog expert. Your ONLY function is to answer questions based EXCLUSIVELY on the provided Netflix CATALOG DATA.
    STRICT RULE: If a user asks a question about general knowledge (e.g., 'What is the capital of France?') or about a title NOT present in the provided catalog data, you MUST reply with a polite, firm refusal, such as: "I am strictly limited to providing information from the Netflix catalog data and cannot answer that question." Do not invent information.`;

    if (contextData) {
      // Enhance prompt with specific data for RAG grounding
      systemPrompt = `${baseSystemPrompt} You should primarily base your recommendations and answers on the following catalog data.
        --- CATALOG DATA ---
        ${contextData}
        --- END OF CATALOG DATA ---
        `;
    } else {
      // Use the base prompt only. This relies on the model's ability to reject out-of-scope queries
      // based on the constraint in the base prompt.
      systemPrompt = baseSystemPrompt;
    }

    // Reset state and prepare user message
    setIsLoading(true);
    setError(null);
    const newUserMessage = {
      role: "user",
      parts: [{ text: augmentedUserQuery }],
    };
    const newHistory = [...chatHistory, newUserMessage];
    setChatHistory(newHistory);
    setUserInput(""); // Clear input immediately

    try {
      const modelResponseText = await callGeminiApi(newHistory, systemPrompt);

      // Stop initial loading, start typing simulation
      setIsLoading(false);
      startTypingEffect(modelResponseText);
    } catch (e) {
      console.error("Critical Chat Error:", e.message);
      setError(e.message);

      // Remove the user message from history if the response failed
      setChatHistory((prev) => prev.slice(0, prev.length - 1));
      setIsLoading(false); // Ensure loading stops on error
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      sendMessage();
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4 sm:p-6 bg-gray-50 font-sans">
      {/* Main Chat Container */}
      <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl flex flex-col h-[85vh] transition-all duration-300 border border-gray-100">
        {/* Header */}
        <header className="p-4 border-b border-blue-100 bg-blue-600 rounded-t-xl shadow-md">
          <h1 className="text-xl font-bold text-white flex items-center">
            {/* Header Icon with explicit sizing (h-6 w-6) */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 inline mr-2"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
            </svg>
            Netflix Recommendation Bot
          </h1>
        </header>

        {/* Messages Display Area */}
        <div
          ref={chatMessagesRef}
          className="flex-grow p-4 overflow-y-auto space-y-4 bg-white"
        >
          {chatHistory.map((msg, index) => (
            <ChatBubble key={index} role={msg.role} text={msg.parts[0].text} />
          ))}

          {/* Typing/Streaming Indicator for In-Progress Response */}
          {streamingText && (
            <ChatBubble role="model" text={streamingText} isStreaming={true} />
          )}

          {/* Initial Loading Indicator (Only shows while fetching the *full* response) */}
          {isLoading && !streamingText && (
            <div className="flex justify-start">
              <div className="bg-blue-50 text-blue-700 p-3 rounded-xl rounded-tl-none shadow-md flex items-center space-x-2">
                {/* Loading Spinner with explicit sizing (h-5 w-5) */}
                <svg
                  className="animate-spin h-5 w-5 text-blue-600"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                <span className="text-sm font-medium">
                  Querying Netflix Catalog...
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 text-center bg-red-100 border-t border-red-300">
            <p className="text-red-700 text-sm font-semibold whitespace-pre-wrap">
              {error}
            </p>
          </div>
        )}

        {/* Input Area */}
        <div className="p-4 border-t border-gray-200 flex space-x-3 bg-white rounded-b-xl">
          <input
            type="text"
            id="user-input"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask about our shows: e.g., 'What is the highest rated show?'"
            className="flex-grow p-3 border border-gray-300 rounded-full focus:outline-none focus:ring-4 focus:ring-blue-100 transition duration-200 shadow-inner text-sm"
            disabled={isLoading || !!streamingText}
          />
          <button
            onClick={sendMessage}
            className={`
              bg-blue-600 text-white p-3 rounded-full transition duration-300 ease-in-out shadow-lg transform hover:scale-105 hover:bg-blue-700
              ${
                !userInput.trim() || isLoading || !!streamingText
                  ? "opacity-50 cursor-not-allowed shadow-none"
                  : ""
              }
            `}
            disabled={!userInput.trim() || isLoading || !!streamingText}
          >
            {/* Send Icon with explicit sizing (h-5 w-5) */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 00.183.323l.162.245 4.544-2.272a1 1 0 00.312-.218l.847-.848a1 1 0 011.414 0l.848.848a1 1 0 00.218.312l4.632 2.316a1 1 0 00.162-.245l.183-.323-7-14z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
