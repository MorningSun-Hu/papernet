#[tokio::main]
async fn main() {
    if let Err(err) = papernet_teacher::run().await {
        eprintln!("papernet-teacher: {err}");
        std::process::exit(1);
    }
}
