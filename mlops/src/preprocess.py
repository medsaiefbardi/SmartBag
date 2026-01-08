# mlops/src/preprocess.py

import pandas as pd
from pathlib import Path


def main():
    # --------------------------------------------------
    # Paths
    # --------------------------------------------------
    RAW_DATA_PATH = Path("data/raw/Telco_customer_churn.xlsx")
    PROCESSED_DATA_DIR = Path("data/processed")
    PROCESSED_DATA_PATH = PROCESSED_DATA_DIR / "telco_clean.csv"

    PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)

    # --------------------------------------------------
    # Load raw dataset
    # --------------------------------------------------
    df = pd.read_excel(RAW_DATA_PATH)

    # --------------------------------------------------
    # Normalize column names (real-world datasets)
    # --------------------------------------------------
    df.columns = (
        df.columns
        .str.strip()
        .str.lower()
        .str.replace(" ", "_")
    )

    # --------------------------------------------------
    # Select target column (REAL Telco dataset)
    # --------------------------------------------------
    if "churn_value" not in df.columns:
        raise ValueError(
            f"'churn_value' not found. Available columns: {list(df.columns)}"
        )

    # --------------------------------------------------
    # Drop leakage & non-predictive columns
    # --------------------------------------------------
    columns_to_drop = [
        "customerid",
        "churn_label",
        "churn_score",
        "churn_reason",
        "lat_long",
        "tenure_months"
    ]


    df = df.drop(columns=[c for c in columns_to_drop if c in df.columns])

    # --------------------------------------------------
    # Convert numeric columns stored as text
    # --------------------------------------------------
    if "total_charges" in df.columns:
        df["total_charges"] = pd.to_numeric(
            df["total_charges"], errors="coerce"
        )

    # --------------------------------------------------
    # Drop missing values
    # --------------------------------------------------
    df = df.dropna().reset_index(drop=True)

    # --------------------------------------------------
    # Separate target
    # --------------------------------------------------
    df["churn"] = df["churn_value"].astype(int)
    df = df.drop(columns=["churn_value"])

    # --------------------------------------------------
    # One-hot encode categorical features
    # --------------------------------------------------
    categorical_cols = df.select_dtypes(include=["object"]).columns.tolist()
    df = pd.get_dummies(df, columns=categorical_cols, drop_first=True)

    # --------------------------------------------------
    # Save processed dataset
    # --------------------------------------------------
    df.to_csv(PROCESSED_DATA_PATH, index=False)

    print("Preprocessing completed successfully")
    print(f"Processed dataset shape: {df.shape}")
    print(f"Target distribution:\n{df['churn'].value_counts()}")
    print(f"Saved to: {PROCESSED_DATA_PATH}")


if __name__ == "__main__":
    main()
